from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import time
import unicodedata
from typing import Any

from app.channels.base import AgentReply
from app.core.output import clean_user_visible_text
from app.core.prompts import PromptBuilder, temperature_for_mode
from app.core.tools import ToolRegistry
from app.core.types import AgentContext
from app.db import Database, is_sqlite_locked, retry_sqlite_locked
from app.services.audit import AuditService
from app.services.llm import LLMClient, LLMResponse
from app.services.memory import MemoryService
from app.settings import Settings
from app.utils import safe_json, utc_now


class AgentLoop:
    def __init__(
        self,
        settings: Settings,
        db: Database,
        llm: LLMClient,
        memory: MemoryService,
        tools: ToolRegistry,
        prompts: PromptBuilder,
        audit: AuditService,
    ):
        self.settings = settings
        self.db = db
        self.llm = llm
        self.memory = memory
        self.tools = tools
        self.prompts = prompts
        self.audit = audit
        self.semaphore = asyncio.Semaphore(settings.agent_max_concurrent)

    async def run(self, ctx: AgentContext) -> AgentReply:
        async with self.semaphore:
            return await self._run_locked(ctx)

    async def _run_locked(self, ctx: AgentContext) -> AgentReply:
        task_class = getattr(ctx, "task_class", "agent")
        self._raise_if_cancelled(ctx)
        loop_model = self.llm.resolve_model(task_class, user_id=ctx.user_id)

        ctx_window = 32000
        try:
            with self.db.connect() as conn:
                row = conn.execute("SELECT ctx_window FROM model_profiles WHERE model=?", (loop_model,)).fetchone()
            if row:
                ctx_window = int(row["ctx_window"])
            elif "qwen" in loop_model.lower() or "gpt" in loop_model.lower() or "gemma" in loop_model.lower():
                ctx_window = 128000
        except Exception:
            pass

        ctx.context_budget_chars = min(self.settings.context_budget_chars_max, int(ctx_window * 0.6 * 4))
        if ctx_window >= 32000:
            ctx.tool_result_max_chars = 24000
            ctx.kb_read_max_chars = 40000
        else:
            ctx.tool_result_max_chars = self.settings.tool_result_max_chars
            ctx.kb_read_max_chars = self.settings.kb_read_max_chars

        raw_history = self.memory.recent_messages(ctx.user_id, ctx.session_id, self.settings.max_history_messages)
        original_message = ctx.message
        effective_message = self._effective_message(ctx.message, raw_history)
        external_message_persistence = bool(getattr(ctx, "user_msg_db_id", None))
        if ctx.mode != "workflow_step" and not external_message_persistence:
            self.memory.add_message(ctx.user_id, ctx.session_id, "user", original_message, tg_message_id=ctx.tg_message_id, reply_to_tg_message_id=ctx.reply_to_tg_message_id)
        if effective_message is None:
            reply = AgentReply(text="Bạn gửi lại câu hỏi hoặc chủ đề muốn Quéo xử lý nhé.", mode="static")
            if ctx.mode != "workflow_step" and not external_message_persistence:
                self.memory.add_message(ctx.user_id, ctx.session_id, "assistant", reply.text)
            return reply
        if effective_message != original_message:
            self.audit.record(ctx.user_id, "query_rewritten", ctx.session_id, {"from": original_message, "to": effective_message})
            ctx.message = effective_message
        history = self._history_for_context(ctx, raw_history)
        started = time.perf_counter()
        mode = self.settings.toolcall_mode if self.settings.has_llm else "fallback"
        try:
            self._raise_if_cancelled(ctx)
            if not self.settings.has_llm:
                reply = await self._fallback(ctx)
            elif mode == "json":
                reply = await self._run_json(ctx, history, started, loop_model, task_class)
            else:
                reply = await self._run_native(ctx, history, started, loop_model, task_class)
        except Exception as exc:
            if self.settings.has_llm and mode == "native" and self._should_retry_json_after_native_error(exc):
                self.audit.record(ctx.user_id, "agent_native_error", ctx.session_id, {"error": str(exc)})
                try:
                    reply = await self._run_json(ctx, history, started, loop_model, task_class)
                except Exception as json_exc:
                    self.audit.record(
                        ctx.user_id,
                        "agent_error",
                        ctx.session_id,
                        {"error": str(json_exc), "native_error": str(exc)},
                    )
                    reply = await self._fallback(ctx, reason=str(json_exc))
            else:
                self.audit.record(ctx.user_id, "agent_error", ctx.session_id, {"error": str(exc)})
                reply = await self._fallback(ctx, reason=str(exc))

        if ctx.mode != "workflow_step" and not external_message_persistence:
            self.memory.add_message(ctx.user_id, ctx.session_id, "assistant", reply.text)
        if ctx.mode != "workflow_step":
            if self.settings.has_llm and reply.mode != "fallback":
                asyncio.create_task(self._extract_facts(ctx.user_id, original_message))
                asyncio.create_task(self._trigger_rolling_summary(ctx.user_id, ctx.session_id))
        return reply

    async def _run_retrieval_qa(self, ctx: AgentContext, history: list[dict[str, str]], started: float, loop_model: str, task_class: str) -> AgentReply:
        hits = await self._search_hits(ctx.message, top_k=5, ctx=ctx)
        if not hits:
            return self._reply("Mình chưa tìm thấy thông tin đủ liên quan trong KB cho câu hỏi này.", ctx, 0, "fallback")
        ctx.citations.extend(hit.path for hit in hits)
        messages = [
            {"role": "system", "content": self._retrieval_system_prompt(ctx)},
            {
                "role": "user",
                "content": (
                    f"Câu hỏi cần trả lời: {ctx.message}\n\n"
                    f"Ngữ cảnh hội thoại gần đây:\n{self._compact_history_for_prompt(history)}\n\n"
                    f"Trích xuất KB nội bộ:\n{self._retrieval_context(hits)}\n\n"
                    "Hãy trả lời trực tiếp cho user bằng tiếng Việt."
                ),
            },
        ]
        try:
            resp = await self.llm.chat(
                loop_model,
                messages,
                tools=None,
                temperature=temperature_for_mode(ctx.mode),
                timeout=min(18, self._llm_timeout_for_mode(ctx.mode, started)),
                user_id=ctx.user_id,
                task_class=task_class,
            )
            self._record_llm_call(resp, "retrieval_qa", ctx)
            text = resp.content.strip()
            if not text:
                raise RuntimeError("empty retrieval QA response")
            return self._reply(text, ctx, 1, "retrieval")
        except Exception as exc:
            self.audit.record(ctx.user_id, "agent_retrieval_error", ctx.session_id, {"error": str(exc)})
            return await self._fallback(ctx, reason=str(exc), hits=hits)

    async def _run_native(self, ctx: AgentContext, history: list[dict[str, str]], started: float, loop_model: str, task_class: str) -> AgentReply:
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.prompts.build(ctx, json_mode=False)}]
        messages.extend(history)
        messages.append({"role": "user", "content": ctx.message})
        tools = self.tools.schemas()
        used_kb_tool = False
        provenance_retry_sent = False
        max_steps = self._max_steps_for_mode(ctx.mode)
        for step in range(1, max_steps + 1):
            self._raise_if_cancelled(ctx)
            self._note_progress(ctx, step=step, max_steps=max_steps, phase="đang gọi model")
            self._check_total_timeout(started, ctx.mode)
            messages = self._compact(messages, ctx)
            resp = await self.llm.chat(
                loop_model,
                messages,
                tools=tools,
                temperature=temperature_for_mode(ctx.mode),
                timeout=self._llm_timeout_for_mode(ctx.mode, started),
                user_id=ctx.user_id,
                task_class=task_class,
            )
            self._raise_if_cancelled(ctx)
            self._record_llm_call(resp, task_class, ctx)
            if resp.tool_calls:
                assistant_message = resp.raw_message or {"role": "assistant", "content": resp.content}
                messages.append(assistant_message)
                for call in resp.tool_calls[: self.settings.agent_max_parallel_tools]:
                    self._raise_if_cancelled(ctx)
                    self._note_progress(ctx, step=step, max_steps=max_steps, tool_name=call.name)
                    if call.name.startswith("kb_"):
                        used_kb_tool = True
                    result = await self.tools.execute(call.name, call.arguments, ctx)
                    self._note_progress(ctx, step=step, max_steps=max_steps, sources=len(ctx.citations))
                    messages.append({"role": "tool", "tool_call_id": call.id, "name": call.name, "content": result})
                continue
            text = resp.content.strip() or "Mình chưa có đủ thông tin để trả lời chắc chắn."
            if self._should_retry_for_provenance(ctx, used_kb_tool, provenance_retry_sent):
                provenance_retry_sent = True
                messages.append({"role": "assistant", "content": text})
                messages.append({"role": "user", "content": self._provenance_retry_prompt(json_mode=False)})
                continue
            return self._reply(text, ctx, step, "native")
        return await self._summarize_after_budget(ctx, messages, "native", loop_model, task_class)

    async def _run_json(self, ctx: AgentContext, history: list[dict[str, str]], started: float, loop_model: str, task_class: str) -> AgentReply:
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.prompts.build(ctx, json_mode=True) + "\n\nTOOL SCHEMAS:\n" + self.tools.json_mode_description()}]
        messages.extend(history)
        messages.append({"role": "user", "content": ctx.message})
        parse_failures = 0
        used_kb_tool = False
        provenance_retry_sent = False
        max_steps = self._max_steps_for_mode(ctx.mode)
        for step in range(1, max_steps + 1):
            self._raise_if_cancelled(ctx)
            self._note_progress(ctx, step=step, max_steps=max_steps, phase="đang gọi model")
            self._check_total_timeout(started, ctx.mode)
            messages = self._compact(messages, ctx)
            resp = await self.llm.chat(
                loop_model,
                messages,
                tools=None,
                temperature=temperature_for_mode(ctx.mode),
                timeout=self._llm_timeout_for_mode(ctx.mode, started),
                user_id=ctx.user_id,
                task_class=task_class,
            )
            self._raise_if_cancelled(ctx)
            self._record_llm_call(resp, task_class, ctx)
            action = parse_json_action(resp.content)
            if not action:
                parse_failures += 1
                if parse_failures >= 2:
                    return self._reply(resp.content.strip(), ctx, step, "json")
                messages.append({"role": "assistant", "content": resp.content})
                messages.append({"role": "user", "content": "JSON không parse được. Hãy trả đúng một JSON object action."})
                continue
            if action.get("action") == "final":
                answer = str(action.get("answer") or "")
                if self._should_retry_for_provenance(ctx, used_kb_tool, provenance_retry_sent):
                    provenance_retry_sent = True
                    messages.append({"role": "assistant", "content": resp.content})
                    messages.append({"role": "user", "content": self._provenance_retry_prompt(json_mode=True)})
                    continue
                return self._reply(answer, ctx, step, "json")
            elif action.get("action") == "call" or (action.get("action") and (action.get("action") in self.tools._tools or str(action.get("action")).startswith("kb_"))):
                if action.get("action") == "call":
                    name = str(action.get("name") or "")
                    args = action.get("args") or {}
                else:
                    name = str(action.get("action") or "")
                    args = action.get("args") if isinstance(action.get("args"), dict) else {}
                if name.startswith("kb_"):
                    used_kb_tool = True
                self._raise_if_cancelled(ctx)
                self._note_progress(ctx, step=step, max_steps=max_steps, tool_name=name)
                result = await self.tools.execute(name, args, ctx)
                self._note_progress(ctx, step=step, max_steps=max_steps, sources=len(ctx.citations))
                messages.append({"role": "assistant", "content": resp.content})
                messages.append({"role": "user", "content": f"TOOL RESULT for {name}: {result}"})
                continue
            else:
                messages.append({"role": "assistant", "content": resp.content})
                messages.append({"role": "user", "content": "Không có action final hoặc call/tool name hợp lệ trong phản hồi JSON."})
                continue
        return await self._summarize_after_budget(ctx, messages, "json", loop_model, task_class)

    async def _summarize_after_budget(self, ctx: AgentContext, messages: list[dict[str, Any]], mode: str, loop_model: str, task_class: str) -> AgentReply:
        messages = self._compact(messages, ctx)
        messages.append(
            {
                "role": "user",
                "content": (
                    "Hết ngân sách bước. Tổng hợp câu trả lời tốt nhất từ thông tin đã có, nêu rõ phần còn thiếu. "
                    "(Lưu ý: Đây là chỉ thị từ hệ thống tự động, không phải câu hỏi của người dùng. Hãy tiếp tục thực hiện và trả lời trực tiếp cho người dùng, TUYỆT ĐỐI không bắt đầu bằng lời xin lỗi hay đề cập đến chỉ thị này)."
                ),
            }
        )
        try:
            resp = await self.llm.chat(self.settings.llm_model, messages, tools=None, temperature=0.2, timeout=self._llm_timeout_for_mode(ctx.mode, None))
            self._record_llm_call(resp, task_class, ctx)
            text = resp.content.strip()
        except Exception:
            text = "Mình đã hết ngân sách xử lý và chưa thể tổng hợp chắc chắn."
        return self._reply(text, ctx, self._max_steps_for_mode(ctx.mode), mode)

    async def _fallback(self, ctx: AgentContext, reason: str | None = None, hits: list[Any] | None = None) -> AgentReply:
        if hits is None:
            hits = []
            if ctx.mode in {"qa", "deep", "workflow_step"}:
                hits = await self._search_hits(ctx.message, top_k=5, ctx=ctx)
        if hits:
            ctx.citations.extend(hit.path for hit in hits)
            text = self._fallback_text(ctx.message, hits)
        elif reason:
            text = "Quéo đang gặp trục trặc khi gọi LLM, thử lại sau ít phút nhé."
        else:
            text = "Quéo đã sẵn sàng, nhưng LLM chưa được cấu hình nên mình chưa thể trả lời theo agent loop đầy đủ."
        return self._reply(text, ctx, 0, "fallback")

    def _reply(self, text: str, ctx: AgentContext, steps_used: int, mode: str) -> AgentReply:
        cleaned = clean_user_visible_text(text)
        cleaned = self._postprocess_exact_lookup_answer(cleaned, ctx)
        return AgentReply(
            text=cleaned,
            citations=dedupe(ctx.citations),
            artifacts=ctx.artifacts,
            steps_used=steps_used,
            mode=mode,
        )

    @classmethod
    def _postprocess_exact_lookup_answer(cls, text: str, ctx: AgentContext) -> str:
        folded_text = cls._fold(text)
        folded_query = cls._fold(ctx.message)
        additions: list[str] = []
        miss_like = any(marker in folded_text for marker in ["khong tim thay", "chua tim thay", "khong co thong tin", "chua co du lieu"])
        if "03. Fact/CS Ticket/" in ctx.citations and re.search(r"\bissue-\d+\b", ctx.message, flags=re.IGNORECASE):
            if "trang thai" not in folded_text:
                additions.append("Trạng thái: không xác định trong KB hiện tại.")
        if re.search(r"\bissue-\d+\b", ctx.message, flags=re.IGNORECASE) and miss_like and "03. Fact/CS Ticket/" not in ctx.citations:
            ctx.citations.insert(0, "03. Fact/CS Ticket/")
            if "trang thai" not in folded_text:
                additions.append("Trạng thái: không xác định trong KB hiện tại.")
        trans_match = re.search(r"\b\d{6,}\b", ctx.message)
        if trans_match:
            if miss_like and "03. Fact/Issue Investigation/" not in ctx.citations:
                ctx.citations.insert(0, "03. Fact/Issue Investigation/")
            if ("transid" in folded_query or "transaction" in folded_query) and "transid" not in folded_text:
                additions.append(f"transID {trans_match.group(0)}: chưa tìm thấy trong KB hiện tại.")
            if ("buoc" in folded_query or "fail" in folded_query or "timeout" in folded_query) and "buoc" not in folded_text:
                additions.append("Bước fail: chưa xác định trong KB hiện tại.")
        if not additions:
            return text
        suffix = "\n" if text.endswith("\n") else "\n\n"
        return text + suffix + "\n".join(additions)

    @staticmethod
    def _history_for_context(ctx: AgentContext, history: list[dict[str, str]]) -> list[dict[str, str]]:
        if ctx.mode == "workflow_step":
            return []
        max_messages = 8 if ctx.mode == "deep" else 6 if ctx.mode == "qa" else 4
        trimmed: list[dict[str, str]] = []
        for message in history[-max_messages:]:
            content = str(message.get("content") or "")
            if len(content) > 2500:
                content = content[:2500] + "\n[history truncated]"
            trimmed.append({"role": str(message.get("role") or "user"), "content": content})
        return trimmed

    def _llm_timeout_for_mode(self, mode: str, started: float | None = None) -> int:
        ceiling = 90 if mode == "deep" else 60 if mode == "workflow_step" else 55
        if started is not None:
            remaining = int(self._total_timeout_for_mode(mode) - (time.perf_counter() - started) - 1)
            ceiling = min(ceiling, remaining)
        return max(5, min(ceiling, self.settings.llm_timeout_seconds))

    def _total_timeout_for_mode(self, mode: str) -> int:
        if mode == "deep":
            return max(30, self.settings.agent_deep_timeout_seconds)
        ceiling = 300 if mode == "workflow_step" else 85
        return max(10, min(ceiling, self.settings.agent_total_timeout_seconds))

    def _max_steps_for_mode(self, mode: str) -> int:
        if mode == "deep":
            return max(self.settings.agent_max_steps, self.settings.agent_deep_max_steps)
        return self.settings.agent_max_steps

    async def _search_hits(self, query: str, top_k: int = 5, ctx: AgentContext | None = None) -> list[Any]:
        try:
            search_ctx = ctx or AgentContext("", "", query, "qa")
            expanded = await self.expand_query_with_lite(query, search_ctx)
            search_query = f"{query} {expanded[:300]}" if expanded else query
            return await self.tools.kb.search_async(search_query, top_k=top_k)
        except Exception:
            return []

    async def expand_query_with_lite(self, query: str, ctx: AgentContext) -> str:
        if not self.settings.llm_model_lite:
            return ""
        prompt = (
            "Mở rộng câu query sau thành 3-8 từ khóa tìm kiếm KB, gồm cả biến thể tiếng Việt/English nếu hữu ích. "
            "Chỉ trả về một dòng từ khóa, không giải thích.\n\n"
            f"Query: {query}"
        )
        try:
            resp = await self.llm.chat(
                self.settings.lite_model,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=120,
                timeout=min(10, self.settings.llm_timeout_seconds),
                user_id=ctx.user_id,
                task_class="lite",
            )
            self._record_llm_call(resp, "query_expansion", ctx)
            text = re.sub(r"[\n\r]+", " ", resp.content)
            text = re.sub(r"[^0-9A-Za-zÀ-ỹ_ .,/:-]+", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            return text[:300]
        except Exception:
            return ""

    def _retrieval_context(self, hits: list[Any]) -> str:
        blocks: list[str] = []
        total = 0
        for idx, hit in enumerate(hits[:3], start=1):
            text = self._read_hit_text(hit)
            if not text:
                text = str(getattr(hit, "snippet", ""))
            text = self._clean_kb_excerpt(text)
            if not text:
                continue
            if len(text) > 1400:
                text = text[:1400].rstrip() + "..."
            block = f"[KB {idx}] {text}"
            blocks.append(block)
            total += len(block)
            if total > 4500:
                break
        return "\n\n".join(blocks)

    def _read_hit_text(self, hit: Any) -> str:
        path = str(getattr(hit, "path", ""))
        lines = str(getattr(hit, "lines", ""))
        match = re.search(r"L(\d+)-L(\d+)", lines)
        start = end = None
        if match:
            start = max(1, int(match.group(1)) - 20)
            end = int(match.group(2)) + 40
        try:
            return self.tools.kb.read(path, start, end)
        except Exception:
            return ""

    def _retrieval_system_prompt(self, ctx: AgentContext) -> str:
        extra = f"\n\nNgữ cảnh bổ sung:\n{ctx.extra_system}" if ctx.extra_system else ""
        return (
            "Bạn là Quéo, trợ lý nội bộ cho Wealth Solution. Trả lời dựa trên KB được cung cấp, "
            "không bịa và không dùng kiến thức ngoài nếu KB chưa đủ.\n"
            "- Không hiển thị citation, tên file, đường dẫn, URL nguồn, hoặc dòng 'Nguồn/Sources'.\n"
            "- Không nhắc tới LLM, tool, agent loop, retrieval, fallback, hay lỗi hệ thống.\n"
            "- Format gọn cho Telegram: mở đầu bằng kết luận ngắn, sau đó bullet rõ ràng; tránh markdown bảng dài.\n"
            "- Với câu hỏi về luồng sản phẩm, ưu tiên các mục: Mục tiêu, Happy flow, Validation/Error, Ghi chú triển khai.\n"
            "- Nếu dữ liệu chưa đủ, nói rõ phần chưa chắc trong một câu ngắn."
            + extra
        )

    @staticmethod
    def _compact_history_for_prompt(history: list[dict[str, str]]) -> str:
        rows = []
        for item in history[-4:]:
            role = str(item.get("role") or "")
            content = re.sub(r"\s+", " ", str(item.get("content") or "")).strip()
            if content:
                rows.append(f"{role}: {content[:500]}")
        return "\n".join(rows) if rows else "(không có)"

    def _fallback_snippets(self, hits: list[Any]) -> str:
        bullets = []
        for hit in hits[:4]:
            snippet = self._clean_kb_excerpt(str(getattr(hit, "snippet", "")))
            if not snippet:
                continue
            if len(snippet) > 320:
                snippet = snippet[:320].rstrip() + "..."
            bullets.append(f"- {snippet}")
        return "\n".join(bullets)

    def _fallback_text(self, query: str, hits: list[Any]) -> str:
        structured = self._structured_fallback_answer(query, hits)
        if structured:
            return structured
        snippets = self._fallback_snippets(hits)
        text = "Mình tìm được thông tin liên quan trong KB, tóm tắt nhanh:"
        text += "\n" + snippets if snippets else "\nMình tìm thấy một số tài liệu liên quan nhưng chưa trích được đoạn đủ rõ để hiển thị."
        return text

    def _structured_fallback_answer(self, query: str, hits: list[Any]) -> str:
        folded = self._fold(query)
        if "stock" not in folded or "nap tien" not in folded:
            return ""
        combined = self._clean_kb_excerpt(" ".join(str(getattr(hit, "snippet", "")) for hit in hits[:5]))
        lower = self._fold(combined)
        bullets: list[str] = []
        if "6-10%" in combined or "6 - 10%" in combined or "drop" in lower:
            bullets.append("Mục tiêu: revamp luồng nạp tiền Stock để giảm drop ở bước chọn option và tăng CVR.")
        if any(marker in lower for marker in ["roll out", "release", "monitor", "control risk", "a b test", "ab test"]):
            bullets.append("Rollout: có A/B test/release theo tỷ lệ để monitor hiệu quả và kiểm soát rủi ro khi mở luồng mới.")
        if any(marker in lower for marker in ["bottom sheet", "deposit screen", "revamp"]):
            bullets.append("UI/UX: KB nhắc tới deposit screen/bottom sheet mới nhằm làm trải nghiệm nạp tiền mượt hơn.")
        if not bullets:
            return ""
        bullets.append("Phần KB match nhanh chưa đủ để kết luận chắc về money flow, validation chi tiết và đối soát.")
        return "Mình tóm tắt nhanh luồng nạp tiền Stock trong KB hiện có:\n" + "\n".join(f"- {bullet}" for bullet in bullets)

    @staticmethod
    def _clean_kb_excerpt(text: str) -> str:
        text = clean_user_visible_text(text)
        text = re.sub(r"(?m)^\s*\d+:\s*", "", text)
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
        text = re.sub(r"\bimage[-=]\d{4}-\d{2}-\d{2}[-\w.]*\s*(?:\|\s*)?(?:width|height)=[^\s]+", " ", text)
        text = re.sub(r"\b(?:width|height)=\d+[!,]?", " ", text)
        text = re.sub(r"https?://\S+", " ", text)
        text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\bh[1-6]\.\s*", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\b(?:Status|Assignee|Updated|Sprint|Epic|Labels?|Reporter):\s*[^#|]+", " ", text)
        text = re.sub(r"\b(?:Jira Issue|Description|Context)\s*:?", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\bJira[a-z0-9-]{12,}\b", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\b[a-f0-9]{8,}(?:-[a-f0-9]{4,}){2,}\b", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\b[A-Z]{2,10}-\d+\b", " ", text)
        text = re.sub(r"\bcs_group\d+\b", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\(\d{4}-\d{2}-\d{2}T[^)]*\)", " ", text)
        text = re.sub(r"\bStockFE\b", "Stock FE", text)
        text = re.sub(r"\|?\s*-{3,}\s*\|?", " ", text)
        text = text.replace("|", " ")
        text = re.sub(r"[*_`~#>\[\]{}]", "", text)
        text = re.sub(r"\s+", " ", text).strip(" -:;,.")
        return text

    @staticmethod
    def _fold(text: str) -> str:
        normalized = unicodedata.normalize("NFD", text.lower())
        return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")

    @staticmethod
    def _effective_message(message: str, history: list[dict[str, str]]) -> str | None:
        if not AgentLoop._is_retry_followup(message):
            return message
        for item in reversed(history):
            if item.get("role") != "user":
                continue
            candidate = str(item.get("content") or "").strip()
            if AgentLoop._is_substantive_user_query(candidate):
                return candidate
        return None

    @staticmethod
    def _is_retry_followup(text: str) -> bool:
        normalized = re.sub(r"[!?.~]+", " ", text.strip().lower())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if not normalized:
            return False
        return bool(
            re.fullmatch(
                r"(thử lại|thu lai|retry|try again|làm lại|lam lai|chạy lại|chay lai|tiếp tục|tiep tuc|thực hiện giúp mình|thuc hien giup minh|ok làm đi|ok lam di|làm giúp mình|lam giup minh|xử lý giúp mình|xu ly giup minh)( nhé| nha| đi| giúp mình| giup minh| pls| please)?",
                normalized,
            )
        )

    @staticmethod
    def _is_substantive_user_query(text: str) -> bool:
        normalized = re.sub(r"[!?.~]+", " ", text.strip().lower())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if len(normalized) < 8:
            return False
        if AgentLoop._is_retry_followup(normalized):
            return False
        if re.fullmatch(r"(hi|hello|hey|chào|chao|alo)( (hi|hello|hey|chào|chao|alo))*", normalized):
            return False
        return True

    @staticmethod
    def _should_retry_for_provenance(ctx: AgentContext, used_kb_tool: bool, retry_sent: bool) -> bool:
        return ctx.mode in {"qa", "deep", "workflow_step"} and not retry_sent and not used_kb_tool and not ctx.citations

    @staticmethod
    def _provenance_retry_prompt(json_mode: bool) -> str:
        note = " (Lưu ý: Đây là chỉ thị từ hệ thống tự động, không phải câu hỏi của người dùng. Hãy tiếp tục thực hiện và trả lời trực tiếp cho người dùng, TUYỆT ĐỐI không bắt đầu bằng lời xin lỗi hay đề cập đến chỉ thị này)."
        if json_mode:
            return (
                "Bạn chưa tra cứu Knowledge Base. Trước khi final cho câu hỏi nghiệp vụ, "
                'hãy trả JSON action gọi kb_search hoặc kb_read, ví dụ {"action":"kb_search","args":{"query":"..."}}. '
                "Không tự trả lời từ kiến thức chung." + note
            )
        return (
            "Bạn chưa tra cứu Knowledge Base. Trước khi final cho câu hỏi nghiệp vụ, "
            "hãy gọi kb_search hoặc kb_read để lấy nguồn nội bộ. Không tự trả lời từ kiến thức chung." + note
        )

    @staticmethod
    def _should_retry_json_after_native_error(exc: Exception) -> bool:
        if isinstance(exc, TimeoutError):
            return False
        text = str(exc).lower()
        if re.search(r"\b(?:401|403|404|429|500|502|503|504)\b", text):
            return False
        if any(marker in text for marker in ("timeout", "timed out", "transport", "connection", "request failed")):
            return False
        return True

    async def _extract_facts(self, user_id: str, message: str) -> None:
        if not self.settings.llm_model_lite:
            return
        prompt = (
            "Trích xuất thông tin cá nhân (fact bền) của người dùng từ tin nhắn sau.\n"
            "Chúng ta cần tìm các thông tin như: tên (name), vai trò/vị trí công việc (key: role, giá trị chuẩn hóa thuộc enum: CEO, CFO, Business, Marketing, FA, OP, Product, Developer, QE, ...), và bộ phận/phòng ban (key: department - ví dụ: Wealth, Stock, Operations, v.v.).\n"
            "Chỉ trả về duy nhất một JSON array dạng: "
            '[{"key": "name|preferred_name|role|department|likes|dislikes|note", "value": "..."}]\n'
            "Nếu không trích xuất được thông tin nào mới hoặc tin nhắn không chứa thông tin cá nhân, trả về [].\n\n"
            f"Tin nhắn của người dùng: \"{message}\""
        )
        try:
            resp = await self.llm.chat(
                self.settings.lite_model,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=300,
                timeout=min(20, self.settings.llm_timeout_seconds),
            )
            self._record_llm_call(resp, "facts", AgentContext(user_id, "", message, "chat"))
            facts = json.loads(extract_json(resp.content) or "[]")
            if isinstance(facts, list):
                for fact in facts[:5]:
                    if isinstance(fact, dict):
                        key = str(fact.get("key") or "").strip().lower()
                        val = str(fact.get("value") or "").strip()
                        if not key or not val:
                            continue
                        if key in {"role", "job", "job_role", "chức danh", "vị trí", "chức vụ", "work", "nghề nghiệp"}:
                            normalized_key = "role"
                        elif key in {"department", "dept", "team", "phòng ban", "bộ phận", "phòng"}:
                            normalized_key = "department"
                        elif key in {"name", "tên", "preferred_name"}:
                            normalized_key = "name"
                        else:
                            normalized_key = key
                        self.memory.upsert_fact(user_id, normalized_key, val)
                        self.audit.record(user_id, "fact_extracted", "facts", {"key": normalized_key, "value": val})
        except Exception as e:
            self.audit.record(user_id, "fact_extraction_error", "facts", {"error": str(e)})
            return

    def _record_llm_call(self, resp: LLMResponse, purpose: str, ctx: AgentContext) -> None:
        def write() -> None:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute(
                    """
                    INSERT INTO llm_calls(model, purpose, prompt_tokens, completion_tokens, latency_ms, run_id, user_id, created_at)
                    VALUES (?,?,?,?,?,?,?,?)
                    """,
                    (
                        resp.model or self.settings.llm_model,
                        purpose,
                        int(resp.usage.get("prompt_tokens") or 0),
                        int(resp.usage.get("completion_tokens") or 0),
                        resp.latency_ms,
                        ctx.run_id,
                        ctx.user_id,
                        utc_now(),
                    ),
                )
                conn.commit()

        try:
            retry_sqlite_locked(write)
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            self.audit.record(ctx.user_id, "llm_call_metric_drop", ctx.session_id, {"purpose": purpose})

    @staticmethod
    def _raise_if_cancelled(ctx: AgentContext) -> None:
        if ctx.cancel_event and ctx.cancel_event.is_set():
            raise asyncio.CancelledError()

    @staticmethod
    def _note_progress(
        ctx: AgentContext,
        *,
        step: int | None = None,
        max_steps: int | None = None,
        phase: str | None = None,
        tool_name: str | None = None,
        sources: int | None = None,
    ) -> None:
        handle = ctx.reply_handle
        if handle and hasattr(handle, "note_progress"):
            try:
                handle.note_progress(step=step, max_steps=max_steps, phase=phase, tool_name=tool_name, sources=sources)
            except Exception:
                pass

    def _compact(self, messages: list[dict[str, Any]], ctx: AgentContext) -> list[dict[str, Any]]:
        budget = getattr(ctx, "context_budget_chars", None) or self.settings.context_budget_chars
        total = sum(len(str(message.get("content") or "")) for message in messages)
        if total <= budget:
            return messages
        if len(messages) <= 8:
            return messages
        return messages[:5] + [{"role": "system", "content": "[một phần lịch sử/tool result cũ đã được rút gọn]"}] + messages[-8:]

    async def _trigger_rolling_summary(self, user_id: str, session_id: str) -> None:
        try:
            state = self.memory.get_session_state(user_id, session_id)
            upto_id = state.get("summary_upto_message_id") or 0

            with self.db.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT id, role, content FROM messages
                    WHERE user_id=? AND session_id=? AND id > ?
                    ORDER BY id ASC
                    """,
                    (user_id, session_id, upto_id),
                ).fetchall()

            if not rows or len(rows) <= 6:
                return

            to_summarize = rows[:-2]
            if not to_summarize:
                return

            last_summarized_id = to_summarize[-1]["id"]

            messages_text = ""
            for r in to_summarize:
                messages_text += f"{r['role']}: {r['content']}\n"

            old_summary = state.get("summary") or ""
            prompt = (
                "Tóm tắt phần hội thoại sau và kết hợp với tóm tắt cũ (nếu có) để tạo một tóm tắt hội thoại ngắn gọn (tối đa 1500 ký tự), tập trung vào các vấn đề đã thảo luận/kết luận, và các việc còn mở.\n"
                f"Tóm tắt cũ: {old_summary}\n\n"
                f"Các tin nhắn mới:\n{messages_text}\n"
                "Trả về tóm tắt hội thoại mới bằng tiếng Việt ngắn gọn, súc tích (dưới 1500 ký tự):"
            )

            resp = await self.llm.chat(
                self.settings.lite_model,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=500,
                timeout=min(20, self.settings.llm_timeout_seconds),
            )

            new_summary = resp.content.strip()[:1500]
            state["summary"] = new_summary
            state["summary_upto_message_id"] = last_summarized_id
            self.memory.save_session_state(user_id, session_id, state)

            self.audit.record(user_id, "session_summary_updated", session_id, {"last_message_id": last_summarized_id})
        except Exception as e:
            self.audit.record(user_id, "session_summary_error", session_id, {"error": str(e)})

    def _check_total_timeout(self, started: float, mode: str) -> None:
        if time.perf_counter() - started > self._total_timeout_for_mode(mode):
            raise TimeoutError("agent total timeout")


def extract_json(text: str) -> str | None:
    fence = re.search(r"```json\s*(.*?)```", text, re.DOTALL)
    if fence:
        return fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return None


def parse_json_action(text: str) -> dict[str, Any] | None:
    raw = extract_json(text)
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value not in seen:
            out.append(value)
            seen.add(value)
    return out
