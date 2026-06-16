from __future__ import annotations

import sqlite3
from typing import Any

from app.db import Database, is_sqlite_locked, retry_sqlite_locked
from app.utils import log_event, utc_now


class MemoryService:
    def __init__(self, db: Database):
        self.db = db

    def add_message(
        self,
        user_id: str,
        session_id: str,
        role: str,
        content: str,
        tg_message_id: int | None = None,
        reply_to_tg_message_id: int | None = None,
    ) -> int | None:
        last_id = None
        def write() -> None:
            nonlocal last_id
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                cur = conn.execute(
                    """
                    INSERT INTO messages(user_id, session_id, role, content, created_at, tg_message_id, reply_to_tg_message_id)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (user_id, session_id, role, content, utc_now(), tg_message_id, reply_to_tg_message_id),
                )
                last_id = cur.lastrowid
                conn.commit()

        self._best_effort_write("memory_message_db_locked_drop", write)
        return last_id

    def recent_messages(self, user_id: str, session_id: str, limit: int) -> list[dict[str, str]]:
        state = self.get_session_state(user_id, session_id)
        started_msg_id = state.get("segment_started_message_id") or 0
        try:
            with self.db.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT role, content FROM messages
                    WHERE user_id=? AND session_id=? AND id >= ?
                    ORDER BY id DESC LIMIT ?
                    """,
                    (user_id, session_id, started_msg_id, limit),
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
                conn.execute("DELETE FROM session_state WHERE user_id=?", (user_id,))
                conn.commit()

        retry_sqlite_locked(write)

    def get_session_state(self, user_id: str, session_id: str) -> dict[str, Any]:
        try:
            with self.db.connect() as conn:
                row = conn.execute(
                    "SELECT * FROM session_state WHERE user_id=? AND session_id=?",
                    (user_id, session_id),
                ).fetchone()
            if row:
                return dict(row)
        except Exception:
            pass
        return {
            "user_id": user_id,
            "session_id": session_id,
            "segment_no": 1,
            "segment_started_message_id": 0,
            "summary": "",
            "summary_upto_message_id": 0,
            "active_skill": None,
            "active_skill_expires_at": None,
            "last_run_id": None,
            "pending_question": None,
            "updated_at": utc_now(),
        }

    def save_session_state(self, user_id: str, session_id: str, state: dict[str, Any]) -> None:
        now = utc_now()
        def write() -> None:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute(
                    """
                    INSERT INTO session_state(
                        user_id, session_id, segment_no, segment_started_message_id,
                        summary, summary_upto_message_id, active_skill, active_skill_expires_at,
                        last_run_id, pending_question, updated_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(user_id, session_id) DO UPDATE SET
                        segment_no=excluded.segment_no,
                        segment_started_message_id=excluded.segment_started_message_id,
                        summary=excluded.summary,
                        summary_upto_message_id=excluded.summary_upto_message_id,
                        active_skill=excluded.active_skill,
                        active_skill_expires_at=excluded.active_skill_expires_at,
                        last_run_id=excluded.last_run_id,
                        pending_question=excluded.pending_question,
                        updated_at=excluded.updated_at
                    """,
                    (
                        user_id,
                        session_id,
                        state.get("segment_no", 1),
                        state.get("segment_started_message_id", 0),
                        state.get("summary", ""),
                        state.get("summary_upto_message_id", 0),
                        state.get("active_skill"),
                        state.get("active_skill_expires_at"),
                        state.get("last_run_id"),
                        state.get("pending_question"),
                        now,
                    ),
                )
                conn.commit()

        self._best_effort_write("memory_save_session_state_error", write)

    @staticmethod
    def _best_effort_write(event: str, write: Any) -> None:
        try:
            retry_sqlite_locked(write)
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            log_event("warning", event)
