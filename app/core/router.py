from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from collections import defaultdict
from typing import Any

from app.channels.base import AgentReply, IncomingMessage, ReplyHandle
from app.core.agent_loop import AgentLoop, extract_json
from app.core.types import AgentContext
from app.services.audit import AuditService
from app.services.guardrail import REFUSAL_TEXT, GuardrailService
from app.services.registry import SkillRegistry, WorkflowRegistry


class MessageRouter:
    def __init__(
        self,
        agent_loop: AgentLoop,
        skills: SkillRegistry,
        workflows: WorkflowRegistry,
        audit: AuditService,
        guardrail: GuardrailService | None = None,
        workflow_engine: Any | None = None,
    ):
        self.agent_loop = agent_loop
        self.skills = skills
        self.workflows = workflows
        self.audit = audit
        self.guardrail = guardrail
        self.workflow_engine = workflow_engine
        self._session_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._session_cancel_events: dict[str, asyncio.Event] = {}
        self._session_tasks: dict[str, asyncio.Task] = {}
        self._registry_version: str | None = None

    async def handle(self, incoming: IncomingMessage, reply_handle: ReplyHandle | None = None) -> AgentReply:
        self._refresh_runtime_config()
        if self._is_session_cancel_command(incoming.text):
            cancelled = self.cancel_session(incoming.session_id, incoming.actor or incoming.user_id, incoming.channel)
            text = "Đã hủy lượt xử lý hiện tại." if cancelled else "Không có lượt xử lý nào đang chạy để hủy."
            return AgentReply(text=text, mode="cancelled" if cancelled else "static")
        async with self._session_locks[incoming.session_id]:
            cancel_event = asyncio.Event()
            task = asyncio.current_task()
            self._session_cancel_events[incoming.session_id] = cancel_event
            if task:
                self._session_tasks[incoming.session_id] = task
            try:
                return await self._handle_locked(incoming, reply_handle, cancel_event)
            except asyncio.CancelledError:
                self.audit.record(
                    incoming.actor or incoming.user_id,
                    "agent_cancelled",
                    incoming.channel,
                    {"session_id": incoming.session_id},
                )
                return AgentReply(text="Đã hủy lượt xử lý hiện tại.", mode="cancelled")
            finally:
                if self._session_cancel_events.get(incoming.session_id) is cancel_event:
                    self._session_cancel_events.pop(incoming.session_id, None)
                if task and self._session_tasks.get(incoming.session_id) is task:
                    self._session_tasks.pop(incoming.session_id, None)

    def cancel_session(self, session_id: str, actor: str = "system", channel: str = "direct") -> bool:
        cancelled = False
        event = self._session_cancel_events.get(session_id)
        if event:
            event.set()
            cancelled = True
        task = self._session_tasks.get(session_id)
        if task and not task.done():
            task.cancel()
            cancelled = True
        if cancelled:
            self.audit.record(actor, "agent_cancel_requested", channel, {"session_id": session_id})
        return cancelled

    async def _handle_locked(
        self,
        incoming: IncomingMessage,
        reply_handle: ReplyHandle | None = None,
        cancel_event: asyncio.Event | None = None,
    ) -> AgentReply:
        text = incoming.text
        forced_deep, text = self._extract_deep_command(text)
        if self.guardrail:
            blocked = self.guardrail.check(text)
            if blocked:
                self.audit.record(
                    incoming.actor or incoming.user_id,
                    "guardrail_block",
                    incoming.channel,
                    {"category": blocked.category, "prompt_hash": blocked.prompt_hash},
                )
                return AgentReply(text=REFUSAL_TEXT, mode="guardrail")

        pending_reply = await self._handle_pending_workflow_confirmation(incoming, text, reply_handle)
        if pending_reply:
            self._audit_exchange(incoming, text, pending_reply, pending_reply.mode)
            return pending_reply

        static_reply = self._static_chat_reply(incoming.text)
        if static_reply:
            self._audit_exchange(incoming, text, static_reply, "chat")
            return static_reply

        workflow_reply = await self._maybe_prepare_workflow_confirmation(incoming, text)
        if workflow_reply:
            self._audit_exchange(incoming, text, workflow_reply, workflow_reply.mode)
            return workflow_reply

        mode = "deep" if forced_deep else self._classify_mode(text)
        task_class = self._classify_task_class(text, mode)
        extra = ""
        matched = self.skills.match_keyword(text)
        if matched:
            extra = self.skills.load(matched.skill_id)
            if not forced_deep:
                mode = "qa"
        ctx = AgentContext(
            user_id=incoming.user_id,
            session_id=incoming.session_id,
            message=text,
            mode=mode,
            extra_system=extra,
            reply_handle=reply_handle,
            task_class=task_class,
            reply_context=incoming.reply_context,
            tg_message_id=incoming.tg_message_id,
            reply_to_tg_message_id=incoming.reply_to_tg_message_id,
            user_msg_db_id=incoming.user_msg_db_id,
            cancel_event=cancel_event,
        )
        if matched and matched.kb_path:
            ctx.citations.append(matched.kb_path)
        self.audit.record(incoming.actor or incoming.user_id, "message_in", incoming.channel, {"mode": mode})
        reply = await self.agent_loop.run(ctx)
        self.audit.record(
            incoming.actor or incoming.user_id,
            "message_out",
            incoming.channel,
            {
                "user_id": incoming.user_id,
                "session_id": incoming.session_id,
                "channel": incoming.channel,
                "question": text,
                "answer": reply.text,
                "citations": reply.citations,
                "artifacts": reply.artifacts,
                "mode": reply.mode,
                "steps_used": reply.steps_used,
            },
        )
        return reply

    async def _handle_pending_workflow_confirmation(
        self,
        incoming: IncomingMessage,
        text: str,
        reply_handle: ReplyHandle | None,
    ) -> AgentReply | None:
        state = self.agent_loop.memory.get_session_state(incoming.user_id, incoming.session_id)
        pending = self._decode_pending_workflow(state.get("pending_question"))
        if not pending:
            return None

        decision = self._confirmation_decision(text)
        if decision is None:
            return AgentReply(
                text="Bạn xác nhận giúp mình: Có để chạy workflow, hoặc Không để hủy.",
                mode="workflow_confirm",
            )

        state["pending_question"] = None
        if not decision:
            self.agent_loop.memory.save_session_state(incoming.user_id, incoming.session_id, state)
            return AgentReply(text="Đã hủy yêu cầu chạy workflow.", mode="workflow_cancelled")

        workflow_id = str(pending.get("workflow_id") or "")
        params = str(pending.get("params") or "")
        if not workflow_id or not self.workflow_engine:
            self.agent_loop.memory.save_session_state(incoming.user_id, incoming.session_id, state)
            return AgentReply(text="Mình chưa thể chạy workflow này vì engine chưa sẵn sàng.", mode="workflow_error")

        try:
            run_id = await self.workflow_engine.start(
                workflow_id,
                params,
                incoming.channel,
                incoming.actor or incoming.user_id,
                reply_handle,
            )
        except Exception as exc:
            self.agent_loop.memory.save_session_state(incoming.user_id, incoming.session_id, state)
            self.audit.record(incoming.actor or incoming.user_id, "workflow_intent_start_failed", incoming.channel, {"workflow_id": workflow_id, "error": str(exc)})
            return AgentReply(text="Mình chưa chạy được workflow này. Chi tiết đã được ghi audit/log.", mode="workflow_error")

        state["last_run_id"] = run_id
        self.agent_loop.memory.save_session_state(incoming.user_id, incoming.session_id, state)
        self.audit.record(incoming.actor or incoming.user_id, "workflow_intent_started", incoming.channel, {"workflow_id": workflow_id, "run_id": run_id})
        return AgentReply(text=f"Đã xếp workflow `{workflow_id}` vào run #{run_id}.", mode="workflow_start")

    async def _maybe_prepare_workflow_confirmation(self, incoming: IncomingMessage, text: str) -> AgentReply | None:
        if not self.workflow_engine:
            return None
        workflows = self.workflows.list_enabled()
        if not workflows or not self._looks_workflow_request(text):
            return None

        intent = await self._classify_workflow_intent_with_lite(incoming, text, workflows)
        if not intent:
            intent = self._heuristic_workflow_intent(text, workflows)
        if not intent:
            return None

        workflow_id = str(intent.get("workflow_id") or "")
        workflow = next((item for item in workflows if item.workflow_id == workflow_id), None)
        if not workflow:
            intent = self._heuristic_workflow_intent(text, workflows)
            workflow_id = str(intent.get("workflow_id") or "") if intent else ""
            workflow = next((item for item in workflows if item.workflow_id == workflow_id), None)
        if not workflow:
            return None
        params = str(intent.get("params") or text).strip()
        pending = {
            "type": "workflow_confirm",
            "workflow_id": workflow.workflow_id,
            "workflow_name": workflow.name,
            "params": params,
        }
        state = self.agent_loop.memory.get_session_state(incoming.user_id, incoming.session_id)
        state["pending_question"] = json.dumps(pending, ensure_ascii=False)
        self.agent_loop.memory.save_session_state(incoming.user_id, incoming.session_id, state)
        self.audit.record(
            incoming.actor or incoming.user_id,
            "workflow_intent_detected",
            incoming.channel,
            {"workflow_id": workflow.workflow_id, "params": params},
        )
        params_text = params or "(không có)"
        return AgentReply(
            text=f"Mình hiểu là bạn muốn chạy workflow `{workflow.name}` (`{workflow.workflow_id}`) với tham số: {params_text}\nBạn xác nhận chạy không? Trả lời Có hoặc Không.",
            mode="workflow_confirm",
        )

    async def _classify_workflow_intent_with_lite(
        self,
        incoming: IncomingMessage,
        text: str,
        workflows: list[Any],
    ) -> dict[str, str] | None:
        settings = self.agent_loop.settings
        if not settings.has_llm or not settings.lite_model:
            return None
        workflow_lines = "\n".join(
            f"- {item.workflow_id}: {item.name}. {item.description or ''}"[:500]
            for item in workflows[:50]
        )
        prompt = (
            "Phân loại xem user có đang yêu cầu CHẠY một workflow hay không.\n"
            "Chỉ trả về một JSON object: "
            '{"intent":"workflow|none","workflow_id":"<id hoặc rỗng>","params":"<tham số raw cho workflow hoặc rỗng>"}.\n'
            "Nếu user chỉ hỏi thông tin, giải thích, hoặc không chắc chắn, trả intent none.\n\n"
            f"WORKFLOWS:\n{workflow_lines}\n\n"
            f"USER MESSAGE:\n{text}"
        )
        try:
            resp = await self.agent_loop.llm.chat(
                settings.lite_model,
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=180,
                timeout=min(12, settings.llm_timeout_seconds),
                user_id=incoming.user_id,
                task_class="lite",
            )
            self.agent_loop._record_llm_call(resp, "workflow_intent", AgentContext(incoming.user_id, incoming.session_id, text, "chat"))
            raw = extract_json(resp.content) or "{}"
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("intent") != "workflow":
                return None
            workflow_id = str(data.get("workflow_id") or "").strip()
            if not workflow_id:
                return None
            return {"workflow_id": workflow_id, "params": str(data.get("params") or "").strip()}
        except Exception as exc:
            self.audit.record(incoming.actor or incoming.user_id, "workflow_intent_error", incoming.channel, {"error": str(exc)})
            return None

    def _heuristic_workflow_intent(self, text: str, workflows: list[Any]) -> dict[str, str] | None:
        folded = self._fold(text)
        best: tuple[int, str] | None = None
        for item in workflows:
            candidates = [
                item.workflow_id,
                item.name,
                item.description or "",
                (item.command_alias or "") if hasattr(item, "command_alias") else "",
            ]
            score = 0
            for candidate in candidates:
                candidate_folded = self._fold(str(candidate))
                if candidate_folded and candidate_folded in folded:
                    score = max(score, len(candidate_folded))
            if score and (best is None or score > best[0]):
                best = (score, item.workflow_id)
        if not best:
            return None
        return {"workflow_id": best[1], "params": text.strip()}

    @staticmethod
    def _looks_workflow_request(text: str) -> bool:
        folded = MessageRouter._fold(text)
        return any(
            phrase in folded
            for phrase in [
                "chay",
                "run",
                "thuc hien",
                "lam workflow",
                "workflow",
                "tao bao cao",
                "generate",
                "audit",
                "scan",
                "kiem tra giup",
                "xu ly giup",
            ]
        )

    @staticmethod
    def _confirmation_decision(text: str) -> bool | None:
        normalized = MessageRouter._fold(re.sub(r"[!?.~]+", " ", text.strip()))
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if normalized in {"co", "ok", "oke", "yes", "y", "duoc", "dung roi", "chay di", "lam di", "xac nhan"}:
            return True
        if normalized in {"khong", "ko", "k", "no", "n", "huy", "cancel", "thoi", "dung"}:
            return False
        return None

    @staticmethod
    def _decode_pending_workflow(value: Any) -> dict[str, Any] | None:
        if not value:
            return None
        try:
            data = json.loads(str(value))
        except Exception:
            return None
        if isinstance(data, dict) and data.get("type") == "workflow_confirm":
            return data
        return None

    def _audit_exchange(self, incoming: IncomingMessage, question: str, reply: AgentReply, mode: str) -> None:
        actor = incoming.actor or incoming.user_id
        self.audit.record(actor, "message_in", incoming.channel, {"mode": mode})
        self.audit.record(
            actor,
            "message_out",
            incoming.channel,
            {
                "user_id": incoming.user_id,
                "session_id": incoming.session_id,
                "channel": incoming.channel,
                "question": question,
                "answer": reply.text,
                "citations": reply.citations,
                "artifacts": reply.artifacts,
                "mode": reply.mode,
                "steps_used": reply.steps_used,
            },
        )

    @staticmethod
    def _classify_task_class(text: str, mode: str) -> str:
        if mode == "chat":
            return "lite"
        if mode == "deep":
            return "deep"
        lowered = text.lower()
        code_patterns = [
            r"\b\w+\.(py|go|java|js|ts|cpp|h|c|sh|sql|json|yaml|yml|md|xml)\b",
            r"\bhàm\b",
            r"\bcode\b",
            r"\bclass\b",
            r"\bstruct\b",
            r"\bfunction\b",
            r"\bphương thức\b",
            r"\binterface\b",
            r"\btable\b",
            r"\bbảng\b",
            r"\bdatabase\b",
            r"\bcơ sở dữ liệu\b",
            r"\bquery\b",
            r"\btruy vấn\b",
            r"\bcompile\b",
            r"\bbuild\b",
            r"\btrace\b",
            r"\bdebug\b",
            r"\bexception\b",
            r"\btransid\b",
            r"\btransactionid\b",
            r"\bcorrelationid\b",
            r"\bendpoint\b",
            r"\bapi\b",
            r"\blog\b",
            r"\bstack trace\b",
            r"\bmã nguồn\b",
            r"\bma nguon\b",
            r"\bsource code\b",
        ]
        for pattern in code_patterns:
            if re.search(pattern, lowered):
                return "code"
        return "agent"

    @staticmethod
    def _is_session_cancel_command(text: str) -> bool:
        return bool(re.fullmatch(r"\s*/cancel(?:@\w+)?\s*", text, flags=re.IGNORECASE))

    @staticmethod
    def _classify_mode(text: str) -> str:
        lowered = text.strip().lower()
        if MessageRouter._static_chat_reply(text):
            return "chat"
        if any(word in lowered for word in ["buồn", "mệt", "stress", "chán"]):
            return "chat"
        if MessageRouter._looks_deep(lowered):
            return "deep"
        return "qa"

    @staticmethod
    def _extract_deep_command(text: str) -> tuple[bool, str]:
        match = re.match(r"^\s*/deep(?:@\w+)?(?:\s+(.+))?$", text, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            return False, text
        stripped = (match.group(1) or "").strip()
        return True, stripped or "Tìm kỹ giúp mình theo knowledge base hiện có."

    @staticmethod
    def _looks_deep(lowered: str) -> bool:
        return any(
            phrase in lowered
            for phrase in [
                "tìm kỹ",
                "tim ky",
                "check kỹ",
                "check ky",
                "đào sâu",
                "dao sau",
                "nghiên cứu sâu",
                "nghien cuu sau",
                "phân tích sâu",
                "phan tich sau",
                "so sánh kỹ",
                "so sanh ky",
            ]
        )

    @staticmethod
    def _static_chat_reply(text: str) -> AgentReply | None:
        normalized = re.sub(r"[!?.~]+", " ", text.strip().lower())
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if re.fullmatch(r"(hi|hello|hey|chào|chao|alo)( (hi|hello|hey|chào|chao|alo))*", normalized):
            return AgentReply(text="Chào bạn! Mình đang sẵn sàng hỗ trợ bạn.", mode="static")
        return None

    @staticmethod
    def _fold(text: str) -> str:
        normalized = unicodedata.normalize("NFD", text.lower())
        return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")

    def _refresh_runtime_config(self) -> None:
        try:
            with self.skills.db.connect() as conn:
                row = conn.execute("SELECT value FROM settings WHERE key='registry_version'").fetchone()
            version = str(row["value"]) if row else ""
        except Exception:
            return
        if self._registry_version == version:
            return
        self._registry_version = version
        if self.guardrail and hasattr(self.guardrail, "reload"):
            self.guardrail.reload()
