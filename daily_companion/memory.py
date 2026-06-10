from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class ChatMessage:
    role: str
    content: str
    created_at: str


@dataclass(frozen=True)
class MemoryFact:
    key: str
    value: str
    updated_at: str


@dataclass(frozen=True)
class TelegramAccess:
    user_id: int
    chat_id: int
    status: str
    display_name: str
    username: str
    updated_at: str


class MemoryStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        parent = Path(db_path).expanduser().resolve().parent
        parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    source_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(user_id, key, value)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_access (
                    user_id INTEGER PRIMARY KEY,
                    chat_id INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    username TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(user_id, session_id, id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id, updated_at)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_telegram_access_status ON telegram_access(status, updated_at)"
            )

    @staticmethod
    def now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def add_message(
        self, user_id: str, session_id: str, role: str, content: str
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (user_id, session_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, session_id, role, content, self.now()),
            )

    def recent_messages(
        self, user_id: str, session_id: str, limit: int
    ) -> list[ChatMessage]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT role, content, created_at
                FROM messages
                WHERE user_id = ? AND session_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (user_id, session_id, limit),
            ).fetchall()

        return [
            ChatMessage(row["role"], row["content"], row["created_at"])
            for row in reversed(rows)
        ]

    def upsert_fact(
        self, user_id: str, key: str, value: str, source_message: str = ""
    ) -> None:
        value = compact_text(value)
        if not value:
            return

        now = self.now()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO facts (user_id, key, value, source_message, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, key, value) DO UPDATE SET
                    source_message = excluded.source_message,
                    updated_at = excluded.updated_at
                """,
                (user_id, key, value, source_message, now, now),
            )

    def facts(self, user_id: str, limit: int = 24) -> list[MemoryFact]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT key, value, updated_at
                FROM facts
                WHERE user_id = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()

        return [MemoryFact(row["key"], row["value"], row["updated_at"]) for row in rows]

    def clear_user(self, user_id: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM messages WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM facts WHERE user_id = ?", (user_id,))

    def get_telegram_access(self, user_id: int) -> TelegramAccess | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT user_id, chat_id, status, display_name, username, updated_at
                FROM telegram_access
                WHERE user_id = ?
                """,
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return TelegramAccess(
            user_id=row["user_id"],
            chat_id=row["chat_id"],
            status=row["status"],
            display_name=row["display_name"],
            username=row["username"],
            updated_at=row["updated_at"],
        )

    def request_telegram_access(
        self, user_id: int, chat_id: int, display_name: str, username: str = ""
    ) -> TelegramAccess:
        now = self.now()
        display_name = compact_text(display_name) or f"user-{user_id}"
        username = compact_text(username)
        current = self.get_telegram_access(user_id)
        if current and current.status == "allowed":
            return current

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO telegram_access
                    (user_id, chat_id, status, display_name, username, created_at, updated_at)
                VALUES (?, ?, 'pending', ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    chat_id = excluded.chat_id,
                    status = CASE
                        WHEN telegram_access.status = 'allowed' THEN 'allowed'
                        ELSE 'pending'
                    END,
                    display_name = excluded.display_name,
                    username = excluded.username,
                    updated_at = excluded.updated_at
                """,
                (user_id, chat_id, display_name, username, now, now),
            )

        return self.get_telegram_access(user_id) or TelegramAccess(
            user_id=user_id,
            chat_id=chat_id,
            status="pending",
            display_name=display_name,
            username=username,
            updated_at=now,
        )

    def approve_telegram_user(self, user_id: int) -> TelegramAccess | None:
        now = self.now()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE telegram_access
                SET status = 'allowed', updated_at = ?
                WHERE user_id = ?
                """,
                (now, user_id),
            )
        return self.get_telegram_access(user_id)

    def reject_telegram_user(self, user_id: int) -> TelegramAccess | None:
        now = self.now()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE telegram_access
                SET status = 'rejected', updated_at = ?
                WHERE user_id = ?
                """,
                (now, user_id),
            )
        return self.get_telegram_access(user_id)


def compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" .,!?:;\n\t")


def trim_fact_value(value: str) -> str:
    value = compact_text(value)
    for delimiter in (", mình ", ", minh ", ", tôi ", ", toi ", ", i "):
        if delimiter in value:
            value = value.split(delimiter, 1)[0]
    return compact_text(value)


def extract_facts(message: str) -> list[tuple[str, str]]:
    """Extract simple user facts without an LLM.

    This is intentionally conservative: explicit memory requests and common
    preference/name statements only.
    """
    text = compact_text(message)
    lowered = text.lower()
    facts: list[tuple[str, str]] = []

    explicit_patterns: Iterable[str] = (
        r"(?:hãy\s+)?(?:nhớ|ghi nhớ|nho|ghi nho)\s+(?:là|la|rằng|rang)?\s*(.+)",
        r"(?:remember|note)\s+(?:that\s+)?(.+)",
    )
    for pattern in explicit_patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if match:
            facts.append(("note", trim_fact_value(match.group(1))))

    name_patterns: Iterable[tuple[str, str]] = (
        ("preferred_name", r"(?:gọi mình là|goi minh la|call me)\s+(.+)"),
        ("name", r"(?:tên mình là|ten minh la|my name is|i am|i'm)\s+(.+)"),
    )
    for key, pattern in name_patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if match:
            facts.append((key, trim_fact_value(match.group(1))))

    preference_patterns: Iterable[tuple[str, str]] = (
        ("likes", r"(?:mình|tôi|toi|minh|i)\s+(?:rất\s+)?(?:thích|thich|like|love)\s+(.+)"),
        (
            "dislikes",
            r"(?:mình|tôi|toi|minh|i)\s+(?:không|khong|don't|do not)\s+(?:thích|thich|like)\s+(.+)",
        ),
    )
    for key, pattern in preference_patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if match:
            facts.append((key, trim_fact_value(match.group(1))))

    return [(key, compact_text(value)) for key, value in facts if compact_text(value)]
