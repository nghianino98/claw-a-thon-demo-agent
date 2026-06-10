from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_dotenv(path: str | Path = ".env") -> None:
    """Tiny .env loader to keep the agent dependency-free."""
    env_path = Path(path)
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class AgentConfig:
    agent_name: str
    agent_api_key: str
    memory_db_path: str
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    llm_timeout_seconds: float
    max_history_messages: int
    telegram_bot_token: str
    telegram_webhook_secret: str
    telegram_allowed_user_ids: frozenset[int]
    telegram_owner_user_ids: frozenset[int]

    @property
    def has_llm(self) -> bool:
        return bool(self.llm_base_url and self.llm_model)


def get_config() -> AgentConfig:
    load_dotenv()
    return AgentConfig(
        agent_name=os.getenv("AGENT_NAME", "Mây"),
        agent_api_key=os.getenv("AGENT_API_KEY", ""),
        memory_db_path=os.getenv("AGENT_MEMORY_DB", ".agent_memory.sqlite3"),
        llm_base_url=os.getenv("LLM_BASE_URL", "").rstrip("/"),
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_model=os.getenv("LLM_MODEL", ""),
        llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
        max_history_messages=int(os.getenv("MAX_HISTORY_MESSAGES", "18")),
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
        telegram_webhook_secret=os.getenv("TELEGRAM_WEBHOOK_SECRET", ""),
        telegram_allowed_user_ids=parse_int_set(
            os.getenv("TELEGRAM_ALLOWED_USER_IDS", "")
        ),
        telegram_owner_user_ids=parse_int_set(
            os.getenv("TELEGRAM_OWNER_USER_IDS", "")
        ),
    )


def parse_int_set(value: str) -> frozenset[int]:
    items: set[int] = set()
    for raw_item in value.replace(";", ",").split(","):
        item = raw_item.strip()
        if not item:
            continue
        try:
            items.add(int(item))
        except ValueError:
            continue
    return frozenset(items)
