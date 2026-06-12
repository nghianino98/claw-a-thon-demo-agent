from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class IncomingMessage:
    user_id: str
    session_id: str
    text: str
    channel: str = "direct"
    actor: str | None = None
    reply_context: str = ""
    tg_message_id: int | None = None
    reply_to_tg_message_id: int | None = None
    user_msg_db_id: int | None = None


@dataclass
class AgentReply:
    text: str
    citations: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    steps_used: int = 0
    mode: str = "fallback"


class ReplyHandle(Protocol):
    async def send_text(self, text: str) -> int | None:
        ...

    async def send_document(self, path: str, caption: str | None = None) -> int | None:
        ...
