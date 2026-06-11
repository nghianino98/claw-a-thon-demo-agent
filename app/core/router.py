from __future__ import annotations

import asyncio
import re
from collections import defaultdict

from app.channels.base import AgentReply, IncomingMessage, ReplyHandle
from app.core.agent_loop import AgentLoop
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
    ):
        self.agent_loop = agent_loop
        self.skills = skills
        self.workflows = workflows
        self.audit = audit
        self.guardrail = guardrail
        self._session_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def handle(self, incoming: IncomingMessage, reply_handle: ReplyHandle | None = None) -> AgentReply:
        async with self._session_locks[incoming.session_id]:
            return await self._handle_locked(incoming, reply_handle)

    async def _handle_locked(self, incoming: IncomingMessage, reply_handle: ReplyHandle | None = None) -> AgentReply:
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

        mode = "deep" if forced_deep else self._classify_mode(text)
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
        )
        self.audit.record(incoming.actor or incoming.user_id, "message_in", incoming.channel, {"mode": mode})
        static_reply = self._static_chat_reply(incoming.text)
        reply = static_reply if static_reply else await self.agent_loop.run(ctx)
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
