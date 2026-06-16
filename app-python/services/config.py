from __future__ import annotations

from pathlib import Path

from app.db import Database
from app.utils import utc_now


class ConfigService:
    def __init__(self, db: Database, persona_file: Path | None = None):
        self.db = db
        self.persona_file = persona_file

    def active_instruction(self, name: str = "persona") -> str:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT content FROM instructions WHERE name=? AND active=1 ORDER BY version DESC LIMIT 1",
                (name,),
            ).fetchone()
        if row:
            return str(row["content"])
        if self.persona_file and self.persona_file.exists():
            return self.persona_file.read_text(encoding="utf-8")
        return ""

    def set_instruction(self, name: str, content: str, actor: str = "system") -> int:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(version), 0) AS version FROM instructions WHERE name=?",
                (name,),
            ).fetchone()
            version = int(row["version"]) + 1
            conn.execute("UPDATE instructions SET active=0 WHERE name=?", (name,))
            cur = conn.execute(
                "INSERT INTO instructions(name, content, version, active, created_at, created_by) VALUES (?,?,?,?,?,?)",
                (name, content, version, 1, utc_now(), actor),
            )
            conn.commit()
            return int(cur.lastrowid)

    def get_setting(self, key: str, default: str = "") -> str:
        with self.db.connect() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def set_setting(self, key: str, value: str, actor: str = "system") -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO settings(key, value, updated_at, updated_by)
                VALUES (?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
                """,
                (key, value, utc_now(), actor),
            )
            conn.commit()

