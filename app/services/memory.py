from __future__ import annotations

import sqlite3
from typing import Any

from app.db import Database, is_sqlite_locked, retry_sqlite_locked
from app.utils import log_event, utc_now


class MemoryService:
    def __init__(self, db: Database):
        self.db = db

    def add_message(self, user_id: str, session_id: str, role: str, content: str) -> None:
        def write() -> None:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute(
                    "INSERT INTO messages(user_id, session_id, role, content, created_at) VALUES (?,?,?,?,?)",
                    (user_id, session_id, role, content, utc_now()),
                )
                conn.commit()

        self._best_effort_write("memory_message_db_locked_drop", write)

    def recent_messages(self, user_id: str, session_id: str, limit: int) -> list[dict[str, str]]:
        try:
            with self.db.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT role, content FROM messages
                    WHERE user_id=? AND session_id=?
                    ORDER BY id DESC LIMIT ?
                    """,
                    (user_id, session_id, limit),
                ).fetchall()
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            log_event("warning", "memory_history_db_locked_empty")
            return []
        return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]

    def upsert_fact(self, user_id: str, key: str, value: str) -> None:
        key = key.strip()[:200]
        value = value.strip()[:200]
        if not key or not value:
            return
        now = utc_now()
        def write() -> None:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                if key.lower() in {"role", "department", "name"}:
                    conn.execute("DELETE FROM facts WHERE user_id=? AND LOWER(key)=?", (user_id, key.lower()))
                conn.execute(
                    """
                    INSERT INTO facts(user_id, key, value, created_at, updated_at)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT(user_id, key, value) DO UPDATE SET updated_at=excluded.updated_at
                    """,
                    (user_id, key, value, now, now),
                )
                conn.commit()

        self._best_effort_write("memory_fact_db_locked_drop", write)

    def facts(self, user_id: str, key: str | None = None) -> list[dict[str, Any]]:
        params: tuple[Any, ...]
        sql = "SELECT key, value, updated_at FROM facts WHERE user_id=?"
        params = (user_id,)
        if key:
            sql += " AND key=?"
            params = (user_id, key)
        sql += " ORDER BY updated_at DESC LIMIT 50"
        try:
            with self.db.connect() as conn:
                rows = conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            log_event("warning", "memory_facts_db_locked_empty")
            return []
        return [dict(row) for row in rows]

    def clear(self, user_id: str) -> None:
        def write() -> None:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute("DELETE FROM messages WHERE user_id=?", (user_id,))
                conn.execute("DELETE FROM facts WHERE user_id=?", (user_id,))
                conn.commit()

        retry_sqlite_locked(write)

    @staticmethod
    def _best_effort_write(event: str, write: Any) -> None:
        try:
            retry_sqlite_locked(write)
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            log_event("warning", event)
