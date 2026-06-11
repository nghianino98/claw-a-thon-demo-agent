from __future__ import annotations

from typing import Any

from app.db import Database
from app.settings import Settings
from app.utils import utc_now


class AccessService:
    def __init__(self, db: Database, settings: Settings):
        self.db = db
        self.settings = settings

    def seed_from_env(self) -> None:
        now = utc_now()
        with self.db.connect() as conn:
            for user_id in self.settings.telegram_owner_user_ids | self.settings.telegram_allowed_user_ids:
                conn.execute(
                    """
                    INSERT INTO telegram_access(user_id, status, approved_by, created_at, updated_at)
                    VALUES (?, 'allowed', 'env', ?, ?)
                    ON CONFLICT(user_id) DO NOTHING
                    """,
                    (user_id, now, now),
                )
            conn.commit()

    def is_owner(self, user_id: int) -> bool:
        return user_id in self.settings.telegram_owner_user_ids

    def status(self, user_id: int) -> str | None:
        if self.is_owner(user_id):
            return "allowed"
        with self.db.connect() as conn:
            row = conn.execute("SELECT status FROM telegram_access WHERE user_id=?", (user_id,)).fetchone()
        return str(row["status"]) if row else None

    def allowed(self, user_id: int) -> bool:
        return self.status(user_id) == "allowed"

    def request_access(self, user: dict[str, Any], chat_id: int) -> str:
        now = utc_now()
        display_name = " ".join(part for part in [user.get("first_name"), user.get("last_name")] if part).strip()
        username = user.get("username")
        with self.db.connect() as conn:
            row = conn.execute("SELECT status FROM telegram_access WHERE user_id=?", (user["id"],)).fetchone()
            if row:
                return str(row["status"])
            conn.execute(
                """
                INSERT INTO telegram_access(user_id, chat_id, display_name, username, status, created_at, updated_at)
                VALUES (?,?,?,?, 'pending', ?, ?)
                """,
                (user["id"], chat_id, display_name, username, now, now),
            )
            conn.commit()
        return "pending"

    def set_status(self, user_id: int, status: str, actor: str, note: str | None = None) -> None:
        if status not in {"allowed", "rejected", "revoked", "pending"}:
            raise ValueError("invalid access status")
        now = utc_now()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO telegram_access(user_id, status, approved_by, note, created_at, updated_at)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET
                  status=excluded.status,
                  approved_by=excluded.approved_by,
                  note=excluded.note,
                  updated_at=excluded.updated_at
                """,
                (user_id, status, actor, note, now, now),
            )
            conn.commit()

    def users(self, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        sql = "SELECT * FROM telegram_access"
        params: tuple[Any, ...] = ()
        if status:
            sql += " WHERE status=?"
            params = (status,)
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params += (limit,)
        with self.db.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

