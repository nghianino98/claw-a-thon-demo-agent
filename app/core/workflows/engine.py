from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from app.channels.base import ReplyHandle
from app.core.agent_loop import dedupe
from app.core.types import AgentContext
from app.core.workflows.parser import parse_workflow
from app.db import Database
from app.services.audit import AuditService
from app.services.registry import WorkflowRegistry
from app.settings import Settings
from app.utils import safe_json, utc_now


class WorkflowEngine:
    def __init__(self, settings: Settings, db: Database, workflows: WorkflowRegistry, agent_loop, audit: AuditService):
        self.settings = settings
        self.db = db
        self.workflows = workflows
        self.agent_loop = agent_loop
        self.audit = audit
        self.semaphore = asyncio.Semaphore(settings.workflow_max_concurrent)
        self.tasks: dict[int, asyncio.Task] = {}

    async def start(
        self,
        workflow_id: str,
        raw_params: str,
        trigger: str,
        triggered_by: str,
        reply_handle: ReplyHandle | None = None,
    ) -> int:
        record = self.workflows.get(workflow_id)
        if not record or not record.enabled:
            raise KeyError(f"workflow not found or disabled: {workflow_id}")
        run_id = self._insert_run(workflow_id, raw_params, trigger, triggered_by)
        task = asyncio.create_task(self._run(run_id, workflow_id, raw_params, triggered_by, reply_handle))
        self.tasks[run_id] = task
        return run_id

    async def cancel(self, run_id: int, actor: str) -> bool:
        task = self.tasks.get(run_id)
        with self.db.connect() as conn:
            row = conn.execute("SELECT status FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                return False
            if row["status"] in {"succeeded", "failed", "cancelled"}:
                return False
            conn.execute("UPDATE workflow_runs SET status='cancelled', finished_at=? WHERE id=?", (utc_now(), run_id))
            conn.commit()
        if task:
            task.cancel()
        self.audit.record(actor, "workflow_cancel", str(run_id), {})
        return True

    def recent_runs(self, limit: int = 5) -> list[dict[str, Any]]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM workflow_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]

    async def _run(
        self,
        run_id: int,
        workflow_id: str,
        raw_params: str,
        user_id: str,
        reply_handle: ReplyHandle | None,
    ) -> None:
        try:
            async with self.semaphore:
                self._mark_running(run_id)
                if reply_handle:
                    await reply_handle.send_text(f"Bắt đầu workflow `{workflow_id}` (run #{run_id})")
                spec = parse_workflow(workflow_id, self.workflows.load(workflow_id))
                state: dict[str, Any] = {"params": {"raw": raw_params}, "outputs": []}
                all_citations: list[str] = []
                for idx, step in enumerate(spec.steps[: self.settings.workflow_max_steps], start=1):
                    if self._is_cancelled(run_id):
                        return
                    extra = (
                        spec.system
                        + "\n\nQuy đổi workflow Cowork sang Quéo: TaskCreate = step engine; present_files/ghi file = make_artifact; link file:/// = kb:path."
                        + "\n\nTrạng thái các bước trước (JSON):\n"
                        + json.dumps(state, ensure_ascii=False)[:8000]
                        + f"\n\nBạn đang ở bước {idx}/{len(spec.steps)}. Chỉ thực hiện bước này."
                    )
                    ctx = AgentContext(
                        user_id=user_id,
                        session_id=f"workflow-{run_id}",
                        message=f"{step}\n\nTham số workflow: {raw_params}",
                        mode="workflow_step",
                        extra_system=extra,
                        reply_handle=reply_handle,
                        run_id=run_id,
                    )
                    reply = await self.agent_loop.run(ctx)
                    all_citations.extend(reply.citations)
                    state["outputs"].append({"step": idx, "summary": reply.text[:2000], "citations": reply.citations})
                    self._append_log(run_id, {"step": idx, "status": "done", "summary": reply.text[:1000], "citations": reply.citations})
                report = self._write_report(run_id, workflow_id, state, dedupe(all_citations))
                self._finish(run_id, "succeeded", [report])
                if reply_handle:
                    await reply_handle.send_text(f"Workflow #{run_id} hoàn tất.")
                    await reply_handle.send_document(str(self.settings.artifacts_dir / str(run_id) / "report.md"), "Báo cáo workflow")
        except asyncio.CancelledError:
            if reply_handle:
                await reply_handle.send_text(f"Workflow #{run_id} đã hủy.")
        except Exception as exc:
            self._append_log(run_id, {"status": "failed", "error": str(exc)})
            self._finish(run_id, "failed", [])
            if reply_handle:
                await reply_handle.send_text("Workflow gặp lỗi. Chi tiết đã được ghi audit/log.")
        finally:
            self.tasks.pop(run_id, None)

    def _insert_run(self, workflow_id: str, raw_params: str, trigger: str, triggered_by: str) -> int:
        with self.db.connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO workflow_runs(workflow_id, trigger, triggered_by, params, status, created_at)
                VALUES (?,?,?,?, 'queued', ?)
                """,
                (workflow_id, trigger, triggered_by, safe_json({"raw": raw_params}), utc_now()),
            )
            conn.commit()
            return int(cur.lastrowid)

    def _mark_running(self, run_id: int) -> None:
        with self.db.connect() as conn:
            conn.execute("UPDATE workflow_runs SET status='running', started_at=? WHERE id=?", (utc_now(), run_id))
            conn.commit()

    def _append_log(self, run_id: int, entry: dict[str, Any]) -> None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT log FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
            log = json.loads(row["log"] or "[]") if row else []
            log.append({"ts": utc_now(), **entry})
            conn.execute("UPDATE workflow_runs SET log=? WHERE id=?", (json.dumps(log, ensure_ascii=False), run_id))
            conn.commit()

    def _finish(self, run_id: int, status: str, artifacts: list[str]) -> None:
        with self.db.connect() as conn:
            conn.execute(
                "UPDATE workflow_runs SET status=?, artifacts=?, finished_at=? WHERE id=?",
                (status, json.dumps(artifacts, ensure_ascii=False), utc_now(), run_id),
            )
            conn.commit()

    def _is_cancelled(self, run_id: int) -> bool:
        with self.db.connect() as conn:
            row = conn.execute("SELECT status FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
        return bool(row and row["status"] == "cancelled")

    def _write_report(self, run_id: int, workflow_id: str, state: dict[str, Any], citations: list[str]) -> str:
        directory = self.settings.artifacts_dir / str(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "report.md"
        lines = [f"# Workflow {workflow_id} - run #{run_id}", "", "## Outputs"]
        for item in state["outputs"]:
            lines.extend(["", f"### Step {item['step']}", item["summary"]])
        if citations:
            lines.extend(["", "## Sources"])
            lines.extend(f"- {citation}" for citation in citations)
        path.write_text("\n".join(lines), encoding="utf-8")
        return f"artifacts/{run_id}/report.md"
