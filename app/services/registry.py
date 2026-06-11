from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.db import Database
from app.utils import slugify, utc_now


FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip("'\"")
    return meta, text[match.end() :]


def extract_triggers(description: str) -> str:
    triggers: set[str] = set()
    lowered = description.lower()
    for marker in ["use when", "whenever", "khi", "dùng khi", "sử dụng khi"]:
        if marker in lowered:
            fragment = lowered.split(marker, 1)[1][:160]
            for part in re.split(r"[,.;\n]| or | hoặc ", fragment):
                part = part.strip(" :-")
                if 3 <= len(part) <= 60:
                    triggers.add(part)
    return "|".join(sorted(triggers))


@dataclass
class SkillRecord:
    skill_id: str
    name: str
    description: str
    triggers: str
    kb_path: str | None
    content_override: str | None
    enabled: bool


@dataclass
class WorkflowRecord:
    workflow_id: str
    name: str
    description: str
    schedule: str | None
    kb_path: str | None
    content_override: str | None
    enabled: bool


class SkillRegistry:
    def __init__(self, db: Database, kb_current: Path):
        self.db = db
        self.kb_current = kb_current

    def reload_from_kb(self) -> int:
        root = self.kb_current / ".agents" / "skills"
        if not root.exists():
            return 0
        count = 0
        for path in root.rglob("SKILL.md"):
            rel = path.relative_to(self.kb_current).as_posix()
            skill_id = slugify(path.parent.relative_to(root).as_posix())
            text = path.read_text(encoding="utf-8", errors="ignore")
            meta, body = parse_frontmatter(text)
            name = meta.get("name") or path.parent.name
            description = meta.get("description") or body.splitlines()[0][:240] if body.splitlines() else name
            triggers = extract_triggers(description)
            self.upsert_kb_skill(skill_id, name, description, triggers, rel)
            count += 1
        return count

    def upsert_kb_skill(self, skill_id: str, name: str, description: str, triggers: str, kb_path: str) -> None:
        now = utc_now()
        with self.db.connect() as conn:
            row = conn.execute("SELECT enabled, content_override, triggers FROM skills WHERE skill_id=?", (skill_id,)).fetchone()
            if row:
                conn.execute(
                    """
                    UPDATE skills
                    SET name=?, description=?, triggers=CASE WHEN triggers='' THEN ? ELSE triggers END,
                        source='kb', kb_path=?, updated_at=?
                    WHERE skill_id=?
                    """,
                    (name, description, triggers, kb_path, now, skill_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO skills(skill_id, name, description, triggers, source, kb_path, enabled, updated_at)
                    VALUES (?,?,?,?, 'kb', ?, 1, ?)
                    """,
                    (skill_id, name, description, triggers, kb_path, now),
                )
            conn.commit()

    def list_enabled(self) -> list[SkillRecord]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM skills WHERE enabled=1 ORDER BY skill_id").fetchall()
        return [self._row(row) for row in rows]

    def get(self, skill_id: str) -> SkillRecord | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM skills WHERE skill_id=?", (skill_id,)).fetchone()
        return self._row(row) if row else None

    def load(self, skill_id: str) -> str:
        record = self.get(skill_id)
        if not record or not record.enabled:
            return f'{{"error":"skill not found or disabled: {skill_id}"}}'
        if record.content_override:
            return record.content_override[:16000]
        if not record.kb_path:
            return f'{{"error":"skill has no content: {skill_id}"}}'
        path = (self.kb_current / record.kb_path).resolve()
        if not _is_relative_to(path, self.kb_current.resolve()) or not path.exists():
            return f'{{"error":"skill file missing: {skill_id}"}}'
        return path.read_text(encoding="utf-8", errors="ignore")[:16000]

    def match_keyword(self, message: str) -> SkillRecord | None:
        text = message.lower()
        for skill in self.list_enabled():
            phrases = [part.strip().lower() for part in skill.triggers.split("|") if part.strip()]
            if any(phrase and phrase in text for phrase in phrases):
                return skill
        return None

    @staticmethod
    def _row(row: Any) -> SkillRecord:
        return SkillRecord(
            skill_id=row["skill_id"],
            name=row["name"],
            description=row["description"],
            triggers=row["triggers"],
            kb_path=row["kb_path"],
            content_override=row["content_override"],
            enabled=bool(row["enabled"]),
        )


class WorkflowRegistry:
    def __init__(self, db: Database, kb_current: Path):
        self.db = db
        self.kb_current = kb_current

    def reload_from_kb(self) -> int:
        root = self.kb_current / ".agents" / "workflows"
        if not root.exists():
            return 0
        count = 0
        for path in root.glob("*.md"):
            rel = path.relative_to(self.kb_current).as_posix()
            workflow_id = slugify(path.stem)
            text = path.read_text(encoding="utf-8", errors="ignore")
            meta, body = parse_frontmatter(text)
            title = _first_heading(body) or path.stem
            description = meta.get("description") or _first_paragraph(body)[:240]
            schedule = meta.get("schedule")
            self.upsert_kb_workflow(workflow_id, title, description, schedule, rel)
            count += 1
        return count

    def upsert_kb_workflow(
        self, workflow_id: str, name: str, description: str, schedule: str | None, kb_path: str
    ) -> None:
        now = utc_now()
        with self.db.connect() as conn:
            row = conn.execute("SELECT workflow_id FROM workflows WHERE workflow_id=?", (workflow_id,)).fetchone()
            if row:
                conn.execute(
                    """
                    UPDATE workflows
                    SET name=?, description=?, schedule=COALESCE(schedule, ?), source='kb', kb_path=?, updated_at=?
                    WHERE workflow_id=?
                    """,
                    (name, description, schedule, kb_path, now, workflow_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO workflows(workflow_id, name, description, source, kb_path, schedule, enabled, updated_at)
                    VALUES (?,?,?, 'kb', ?, ?, 1, ?)
                    """,
                    (workflow_id, name, description, kb_path, schedule, now),
                )
            conn.commit()

    def list_enabled(self) -> list[WorkflowRecord]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM workflows WHERE enabled=1 ORDER BY workflow_id").fetchall()
        return [self._row(row) for row in rows]

    def get(self, workflow_id: str) -> WorkflowRecord | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM workflows WHERE workflow_id=?", (workflow_id,)).fetchone()
        return self._row(row) if row else None

    def load(self, workflow_id: str) -> str:
        record = self.get(workflow_id)
        if not record or not record.enabled:
            raise KeyError(workflow_id)
        if record.content_override:
            return record.content_override
        if not record.kb_path:
            raise FileNotFoundError(workflow_id)
        path = (self.kb_current / record.kb_path).resolve()
        if not _is_relative_to(path, self.kb_current.resolve()) or not path.exists():
            raise FileNotFoundError(workflow_id)
        return path.read_text(encoding="utf-8", errors="ignore")

    @staticmethod
    def _row(row: Any) -> WorkflowRecord:
        return WorkflowRecord(
            workflow_id=row["workflow_id"],
            name=row["name"],
            description=row["description"],
            schedule=row["schedule"],
            kb_path=row["kb_path"],
            content_override=row["content_override"],
            enabled=bool(row["enabled"]),
        )


def _first_heading(text: str) -> str | None:
    for line in text.splitlines():
        if line.startswith("#"):
            return line.lstrip("#").strip()
    return None


def _first_paragraph(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped and lines:
            break
        if stripped and not stripped.startswith("#"):
            lines.append(stripped)
    return " ".join(lines)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False

