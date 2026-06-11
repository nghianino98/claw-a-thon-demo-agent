from __future__ import annotations

from dataclasses import dataclass, field

from app.channels.base import ReplyHandle


@dataclass
class AgentContext:
    user_id: str
    session_id: str
    message: str
    mode: str
    extra_system: str = ""
    reply_handle: ReplyHandle | None = None
    run_id: int | None = None
    citations: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)

