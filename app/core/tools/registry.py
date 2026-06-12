from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.core.output import clean_user_visible_text
from app.core.types import AgentContext
from app.services.kb import KBService
from app.services.memory import MemoryService
from app.services.registry import SkillRegistry
from app.settings import Settings
from app.utils import safe_json


ToolFn = Callable[[dict[str, Any], AgentContext], Awaitable[str]]
QueryExpander = Callable[[str, AgentContext], Awaitable[str]]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolFn


class ToolRegistry:
    def __init__(self, settings: Settings, kb: KBService, memory: MemoryService, skills: SkillRegistry):
        self.settings = settings
        self.kb = kb
        self.memory = memory
        self.skills = skills
        self.query_expander: QueryExpander | None = None
        self._tools = self._build()

    def schemas(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": spec.name,
                    "description": spec.description,
                    "parameters": spec.parameters,
                },
            }
            for spec in self._tools.values()
        ]

    def json_mode_description(self) -> str:
        return safe_json({name: {"description": spec.description, "parameters": spec.parameters} for name, spec in self._tools.items()})

    async def execute(self, name: str, args: dict[str, Any], ctx: AgentContext) -> str:
        spec = self._tools.get(name)
        if not spec:
            return safe_json({"error": f"unknown tool: {name}"})
        try:
            result = await spec.handler(args or {}, ctx)
            limit = getattr(ctx, "tool_result_max_chars", None) or self.settings.tool_result_max_chars
            if len(result) > limit:
                return result[:limit] + "\n[tool result truncated]"
            return result
        except Exception as exc:
            return safe_json({"error": str(exc)[:300]})

    def _build(self) -> dict[str, ToolSpec]:
        return {
            "kb_search": ToolSpec(
                "kb_search",
                "Search the active Wealth Solution knowledge base using SQLite FTS5.",
                {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "product": {"type": "string", "enum": ["MMF", "FD", "FI", "CCQ", "Insurance", "Stock", "Crypto", "FS Hub", "FS Profile"]},
                        "area": {"type": "string", "enum": ["objective", "context", "fact", "skill", "knowledge"]},
                        "top_k": {"type": "integer", "maximum": 10, "default": 5},
                    },
                    "required": ["query"],
                },
                self._kb_search,
            ),
            "kb_grep": ToolSpec(
                "kb_grep",
                "Live scan files in kb/current with ripgrep for exact identifiers, tickets, transIDs, function names, or error strings.",
                {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                        "path_prefix": {"type": "string"},
                        "max_results": {"type": "integer", "maximum": 50, "default": 30},
                    },
                    "required": ["pattern"],
                },
                self._kb_grep,
            ),
            "kb_read": ToolSpec(
                "kb_read",
                "Read a text file inside kb/current with optional line bounds. Blocks path traversal.",
                {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "start_line": {"type": "integer"},
                        "end_line": {"type": "integer"},
                    },
                    "required": ["path"],
                },
                self._kb_read,
            ),
            "kb_list": ToolSpec(
                "kb_list",
                "List the knowledge-base directory tree under a path.",
                {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "default": "."},
                        "depth": {"type": "integer", "maximum": 2, "default": 2},
                    },
                },
                self._kb_list,
            ),
            "load_skill": ToolSpec(
                "load_skill",
                "Load an enabled SKILL.md content by skill_id.",
                {
                    "type": "object",
                    "properties": {"skill_id": {"type": "string"}},
                    "required": ["skill_id"],
                },
                self._load_skill,
            ),
            "remember": ToolSpec(
                "remember",
                "Remember a durable user fact.",
                {
                    "type": "object",
                    "properties": {"key": {"type": "string"}, "value": {"type": "string"}},
                    "required": ["key", "value"],
                },
                self._remember,
            ),
            "recall": ToolSpec(
                "recall",
                "Recall durable user facts.",
                {
                    "type": "object",
                    "properties": {"key": {"type": "string"}},
                },
                self._recall,
            ),
            "report_progress": ToolSpec(
                "report_progress",
                "Send workflow progress to the user when a reply handle exists.",
                {
                    "type": "object",
                    "properties": {"text": {"type": "string"}},
                    "required": ["text"],
                },
                self._report_progress,
            ),
            "make_artifact": ToolSpec(
                "make_artifact",
                "Create a markdown/text artifact for a workflow run.",
                {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string", "pattern": "^[a-zA-Z0-9._-]+$"},
                        "content": {"type": "string"},
                    },
                    "required": ["filename", "content"],
                },
                self._make_artifact,
            ),
        }

    async def _kb_search(self, args: dict[str, Any], ctx: AgentContext) -> str:
        query = str(args["query"])
        original_query = query
        if self.query_expander and ctx.mode in {"qa", "deep", "workflow_step"}:
            try:
                expanded = (await self.query_expander(query, ctx)).strip()
                if expanded and expanded.lower() not in query.lower():
                    query = f"{query} {expanded[:300]}"
            except Exception:
                pass
        hits = await self.kb.search_async(query, args.get("product"), args.get("area"), int(args.get("top_k") or 5))
        exact_rows = self._exact_lookup_rows(original_query, ctx)
        if not exact_rows:
            exact_misses = self._exact_lookup_miss_rows(original_query, ctx)
            if exact_misses:
                return (
                    safe_json(exact_misses[: int(args.get("top_k") or 5)])
                    + "\nKhông tìm thấy định danh exact trong KB hiện tại; trả lời là chưa có dữ liệu thay vì suy đoán. "
                    "Nếu là ISSUE, nêu rõ trạng thái không xác định; nếu là transID, nêu rõ bước fail chưa xác định."
                )
        for hit in hits:
            if hit.path not in ctx.citations:
                ctx.citations.append(hit.path)
        payload = exact_rows + [hit.as_dict() for hit in hits if hit.path not in {row["path"] for row in exact_rows}]
        guidance = "Dùng kb_read(path, start_line, end_line) để đọc đầy đủ trước khi khẳng định."
        if re.search(r"\b(file|source code|code|h[aà]m|function|logic)\b", original_query, flags=re.IGNORECASE):
            guidance += " Nếu câu hỏi hỏi file/hàm/source-code, trả lời rõ chữ 'file', đường dẫn file, và logic liên quan."
        return safe_json(payload[: int(args.get("top_k") or 5)]) + "\n" + guidance

    def _exact_lookup_rows(self, query: str, ctx: AgentContext) -> list[dict[str, Any]]:
        patterns: list[tuple[str, str | None]] = []
        lookup_text = f"{query} {ctx.message}"
        for match in re.finditer(r"\bISSUE-\d+\b", lookup_text, flags=re.IGNORECASE):
            patterns.append((rf"\b{re.escape(match.group(0))}\b", "03. Fact/CS Ticket"))
        for match in re.finditer(r"\b[A-Z]{2,10}-\d+\b", lookup_text):
            if match.group(0).upper().startswith("ISSUE-"):
                continue
            patterns.append((rf"\b{re.escape(match.group(0))}\b", "02. Context/Jira"))
        transid = self._extract_transaction_id(lookup_text)
        if transid:
            patterns.append((rf"\b{re.escape(transid)}\b", "03. Fact/Issue Investigation"))
        if not patterns:
            return []
        deduped_patterns: list[tuple[str, str | None]] = []
        for pattern in patterns:
            if pattern not in deduped_patterns:
                deduped_patterns.append(pattern)

        rows_out: list[dict[str, Any]] = []
        seen_paths: set[str] = set()
        for pattern, prefix in deduped_patterns[:4]:
            try:
                result = self.kb.grep(pattern, prefix, 12)
                rows = json.loads(result)
            except Exception:
                rows = []
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                path = str(row.get("path") or "")
                if not path or path in seen_paths:
                    continue
                seen_paths.add(path)
                if path not in ctx.citations:
                    ctx.citations.append(path)
                rows_out.append(
                    {
                        "path": path,
                        "title": path.rsplit("/", 1)[-1],
                        "snippet": str(row.get("line") or "")[:400],
                        "score": -999.0,
                        "lines": f"L{row.get('line_no') or 1}-L{row.get('line_no') or 1}",
                        "product": "",
                        "area": "fact" if path.startswith("03.") else "context",
                    }
                )
                if len(rows_out) >= 5:
                    return rows_out
        return rows_out

    def _exact_lookup_miss_rows(self, query: str, ctx: AgentContext) -> list[dict[str, Any]]:
        lookup_text = f"{query} {ctx.message}"
        rows: list[dict[str, Any]] = []
        seen_issues: set[str] = set()
        for match in re.finditer(r"\bISSUE-\d+\b", lookup_text, flags=re.IGNORECASE):
            issue = match.group(0).upper()
            if issue in seen_issues:
                continue
            seen_issues.add(issue)
            scope = "03. Fact/CS Ticket/"
            if scope not in ctx.citations:
                ctx.citations.append(scope)
            rows.append(
                {
                    "path": scope,
                    "title": f"Exact lookup miss: {issue}",
                    "snippet": f"Không tìm thấy {issue} trong CS Ticket của KB hiện tại; trạng thái không xác định từ tài liệu.",
                    "score": 999.0,
                    "lines": "",
                    "product": "",
                    "area": "fact",
                    "not_found": True,
                }
            )
        transid = self._extract_transaction_id(lookup_text)
        if transid:
            scope = "03. Fact/Issue Investigation/"
            if scope not in ctx.citations:
                ctx.citations.append(scope)
            rows.append(
                {
                    "path": scope,
                    "title": f"Exact lookup miss: transID {transid}",
                    "snippet": f"Không tìm thấy transID {transid} trong Issue Investigation của KB hiện tại; bước fail chưa xác định từ tài liệu.",
                    "score": 999.0,
                    "lines": "",
                    "product": "",
                    "area": "fact",
                    "not_found": True,
                }
            )
        return rows

    @staticmethod
    def _extract_transaction_id(query: str) -> str | None:
        explicit = re.search(r"\b(?:transid|transactionid|transaction)\s*[:#-]?\s*(\d{6,})\b", query, flags=re.IGNORECASE)
        if explicit:
            return explicit.group(1)
        if not re.search(r"\b(fail|failed|timeout|retry|bước|buoc|giao dịch|giao dich|transaction|trans)\b", query, flags=re.IGNORECASE):
            return None
        bare = re.search(r"\b\d{6,}\b", query)
        return bare.group(0) if bare else None

    async def _kb_grep(self, args: dict[str, Any], ctx: AgentContext) -> str:
        result = self.kb.grep(args["pattern"], args.get("path_prefix"), int(args.get("max_results") or 30))
        try:
            rows = json.loads(result)
        except json.JSONDecodeError:
            rows = []
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    path = str(row.get("path") or "")
                    if path and path not in ctx.citations:
                        ctx.citations.append(path)
        return result

    async def _kb_read(self, args: dict[str, Any], ctx: AgentContext) -> str:
        path = args["path"]
        if path not in ctx.citations:
            ctx.citations.append(path)
        return self.kb.read(path, args.get("start_line"), args.get("end_line"), getattr(ctx, "kb_read_max_chars", None))

    async def _kb_list(self, args: dict[str, Any], ctx: AgentContext) -> str:
        return self.kb.list_tree(args.get("path") or ".", int(args.get("depth") or 2))

    async def _load_skill(self, args: dict[str, Any], ctx: AgentContext) -> str:
        return self.skills.load(args["skill_id"])

    async def _remember(self, args: dict[str, Any], ctx: AgentContext) -> str:
        self.memory.upsert_fact(ctx.user_id, str(args["key"])[:200], str(args["value"])[:200])
        return "ok"

    async def _recall(self, args: dict[str, Any], ctx: AgentContext) -> str:
        return safe_json(self.memory.facts(ctx.user_id, args.get("key")))

    async def _report_progress(self, args: dict[str, Any], ctx: AgentContext) -> str:
        if ctx.reply_handle:
            await ctx.reply_handle.send_text(clean_user_visible_text(str(args["text"]))[:3900])
        return "ok"

    async def _make_artifact(self, args: dict[str, Any], ctx: AgentContext) -> str:
        if ctx.run_id is None:
            return safe_json({"error": "make_artifact requires workflow run_id"})
        filename = str(args["filename"])
        if not re.match(r"^[a-zA-Z0-9._-]+$", filename):
            return safe_json({"error": "invalid filename"})
        content = str(args["content"])
        if len(content.encode("utf-8")) > 2 * 1024 * 1024:
            return safe_json({"error": "artifact too large"})
        directory = self.settings.artifacts_dir / str(ctx.run_id)
        directory.mkdir(parents=True, exist_ok=True)
        if len(list(directory.iterdir())) >= 20:
            return safe_json({"error": "too many artifacts for run"})
        path = directory / filename
        path.write_text(content, encoding="utf-8")
        rel = f"artifacts/{ctx.run_id}/{filename}"
        if rel not in ctx.artifacts:
            ctx.artifacts.append(rel)
        return rel
