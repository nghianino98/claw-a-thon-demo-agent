from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from app.db import Database, is_sqlite_locked, retry_sqlite_locked
from app.settings import Settings
from app.utils import log_event


class RateLimiter:
    def __init__(self, db: Database, settings: Settings):
        self.db = db
        self.settings = settings

    def check(self, user_id: str) -> bool:
        now = datetime.now(UTC)
        minute_key = "minute:" + now.strftime("%Y-%m-%dT%H:%M")
        day_key = "day:" + now.strftime("%Y-%m-%d")

        def write() -> tuple[int, int]:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                minute_count = self._inc(conn, user_id, minute_key)
                day_count = self._inc(conn, user_id, day_key)
                conn.commit()
                return minute_count, day_count

        try:
            minute_count, day_count = retry_sqlite_locked(write)
        except sqlite3.OperationalError as exc:
            if not is_sqlite_locked(exc):
                raise
            log_event("warning", "rate_limit_db_locked_fail_open")
            return True
        return minute_count <= self.settings.rate_limit_per_minute and day_count <= self.settings.rate_limit_per_day

    @staticmethod
    def _inc(conn, user_id: str, window: str) -> int:
        conn.execute(
            """
            INSERT INTO rate_limits(user_id, window_start, count)
            VALUES (?, ?, 1)
            ON CONFLICT(user_id, window_start) DO UPDATE SET count=count+1
            """,
            (user_id, window),
        )
        row = conn.execute(
            "SELECT count FROM rate_limits WHERE user_id=? AND window_start=?",
            (user_id, window),
        ).fetchone()
        return int(row["count"])
