from __future__ import annotations

import json
import sqlite3
from typing import Any

from app.db import Database, is_sqlite_locked, retry_sqlite_locked
from app.utils import log_event, safe_json, utc_now


class AuditService:
    def __init__(self, db: Database):
        self.db = db

    def record(self, actor: str, action: str, target: str | None = None, detail: Any | None = None) -> None:
        payload = (actor, action, target, safe_json(detail or {}), utc_now())

        def write() -> None:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute(
                    "INSERT INTO audit_log(actor, action, target, detail, created_at) VALUES (?,?,?,?,?)",
                    payload,
                )
                conn.commit()

        try:
            retry_sqlite_locked(write)
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            log_event("warning", "audit_db_locked_drop", action=action)

    def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?",
                (min(limit, 200),),
            ).fetchall()
        return [dict(row) for row in rows]

    def answers(self, limit: int = 50, user_id: str | None = None, session_id: str | None = None) -> list[dict[str, Any]]:
        requested = max(1, min(limit, 200))
        scan_limit = min(max(requested * 10, requested), 1000)
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM audit_log
                WHERE action='message_out'
                ORDER BY id DESC LIMIT ?
                """,
                (scan_limit,),
            ).fetchall()

        answers: list[dict[str, Any]] = []
        for row in rows:
            detail = _loads_detail(row["detail"])
            row_user_id = str(detail.get("user_id") or "")
            row_session_id = str(detail.get("session_id") or "")
            if user_id and row_user_id != user_id:
                continue
            if session_id and row_session_id != session_id:
                continue
            answers.append(
                {
                    "id": row["id"],
                    "created_at": row["created_at"],
                    "actor": row["actor"],
                    "channel": detail.get("channel") or row["target"] or "",
                    "user_id": row_user_id,
                    "session_id": row_session_id,
                    "question": str(detail.get("question") or ""),
                    "answer": str(detail.get("answer") or ""),
                    "citations": detail.get("citations") if isinstance(detail.get("citations"), list) else [],
                    "artifacts": detail.get("artifacts") if isinstance(detail.get("artifacts"), list) else [],
                    "mode": str(detail.get("mode") or ""),
                }
            )
            if len(answers) >= requested:
                break
        return answers


def _loads_detail(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}
