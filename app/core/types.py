from __future__ import annotations

import asyncio
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
    task_class: str = "agent"
    reply_context: str = ""
    tg_message_id: int | None = None
    reply_to_tg_message_id: int | None = None
    user_msg_db_id: int | None = None
    cancel_event: asyncio.Event | None = None
    context_budget_chars: int | None = None
    tool_result_max_chars: int | None = None
    kb_read_max_chars: int | None = None
