from __future__ import annotations

import asyncio
import time
import re
import os
from datetime import datetime, UTC
from typing import Any
from croniter import croniter

from app.db import Database
from app.settings import Settings
from app.services.audit import AuditService
from app.core.workflows.engine import WorkflowEngine
from app.utils import log_event, utc_now


class CronSchedulerService:
    def __init__(
        self,
        db: Database,
        settings: Settings,
        workflows: WorkflowEngine,
        audit: AuditService,
        telegram_client: Any = None,
    ):
        self.db = db
        self.settings = settings
        self.workflows = workflows
        self.audit = audit
        self.telegram_client = telegram_client
        self.task: asyncio.Task | None = None
        self._next_runs: dict[str, float] = {}
        self._schedules: dict[str, str] = {}

    def start(self) -> None:
        self.task = asyncio.create_task(self._loop())
        log_event("info", "cron_scheduler_started")

    def stop(self) -> None:
        if self.task:
            self.task.cancel()
            self.task = None
        log_event("info", "cron_scheduler_stopped")

    async def _loop(self) -> None:
        while True:
            try:
                await self._reload_schedules()
                await self._check_and_run()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_event("error", "cron_scheduler_loop_error", error=str(e))
            await asyncio.sleep(15)

    async def _reload_schedules(self) -> None:
        try:
            with self.db.connect() as conn:
                rows = conn.execute(
                    "SELECT workflow_id, schedule FROM workflows WHERE enabled=1 AND schedule IS NOT NULL AND schedule != ''"
                ).fetchall()
        except Exception as e:
            log_event("error", "cron_scheduler_load_failed", error=str(e))
            return

        active_ids = set()
        now = datetime.now(UTC)
        for r in rows:
            wid = r["workflow_id"]
            sched = r["schedule"]
            active_ids.add(wid)
            
            if self._schedules.get(wid) != sched:
                try:
                    if not croniter.is_valid(sched):
                        log_event("warning", "cron_scheduler_invalid_cron", workflow_id=wid, schedule=sched)
                        continue
                    
                    iter = croniter(sched, now)
                    nxt = iter.get_next(datetime)
                    self._next_runs[wid] = nxt.timestamp()
                    self._schedules[wid] = sched
                    log_event("info", "cron_scheduler_scheduled", workflow_id=wid, schedule=sched, next_run=nxt.isoformat())
                except Exception as e:
                    log_event("error", "cron_scheduler_calc_failed", workflow_id=wid, error=str(e))

        for wid in list(self._schedules.keys()):
            if wid not in active_ids:
                self._schedules.pop(wid, None)
                self._next_runs.pop(wid, None)

    async def _check_and_run(self) -> None:
        now_ts = time.time()
        now_dt = datetime.now(UTC)
        
        for wid, nxt_ts in list(self._next_runs.items()):
            if now_ts >= nxt_ts:
                sched = self._schedules[wid]
                try:
                    iter = croniter(sched, now_dt)
                    nxt = iter.get_next(datetime)
                    self._next_runs[wid] = nxt.timestamp()
                except Exception as e:
                    log_event("error", "cron_scheduler_recalc_failed", workflow_id=wid, error=str(e))
                    self._next_runs.pop(wid, None)
                    
                asyncio.create_task(self._run_workflow(wid))

    async def _run_workflow(self, workflow_id: str) -> None:
        log_event("info", "cron_scheduler_triggering", workflow_id=workflow_id)
        self.audit.record("schedule", "workflow_triggered", workflow_id, {"trigger": "schedule"})
        
        try:
            run_id = await self.workflows.start(workflow_id, "", "schedule", "scheduler", None)
            
            while True:
                await asyncio.sleep(5)
                with self.db.connect() as conn:
                    row = conn.execute("SELECT status, finished_at, artifacts FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
                if not row:
                    break
                status = row["status"]
                if status in {"succeeded", "failed", "cancelled"}:
                    await self._notify_owners_of_run(workflow_id, run_id, status, row["finished_at"])
                    break
        except Exception as e:
            log_event("error", "cron_scheduler_run_failed", workflow_id=workflow_id, error=str(e))
            self.audit.record("schedule", "workflow_failed", workflow_id, {"error": str(e)})

    async def _notify_owners_of_run(self, workflow_id: str, run_id: int, status: str, finished_at: str) -> None:
        if not self.telegram_client or not self.telegram_client.configured:
            return
        if not self.settings.telegram_owner_user_ids:
            return
            
        status_emoji = "✅" if status == "succeeded" else "❌" if status == "failed" else "⚠️"
        msg = (
            f"{status_emoji} <b>Workflow Scheduled Report</b>\n"
            f"Workflow ID: <code>{workflow_id}</code>\n"
            f"Run ID: <code>#{run_id}</code>\n"
            f"Trạng thái: <b>{status.upper()}</b>\n"
            f"Hoàn thành lúc: {finished_at}"
        )
        
        artifacts = []
        try:
            with self.db.connect() as conn:
                row = conn.execute("SELECT artifacts FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
            if row and row["artifacts"]:
                import json
                artifacts = json.loads(row["artifacts"])
                if artifacts:
                    msg += "\n\n<b>Artifacts generated:</b>"
                    for art in artifacts:
                        filename = art.split("/")[-1]
                        msg += f"\n- {filename}"
        except Exception:
            pass

        for owner_id in self.settings.telegram_owner_user_ids:
            try:
                await self.telegram_client.send_message(owner_id, msg)
                if artifacts:
                    for art in artifacts:
                        # rel: artifacts/<run_id>/<filename>
                        art_rel = art.replace("artifacts/", "")
                        art_path = self.settings.artifacts_dir / art_rel
                        if art_path.exists():
                            await self.telegram_client.send_document(owner_id, str(art_path), caption=f"Artifact: {art_path.name}")
            except Exception as e:
                log_event("error", "cron_scheduler_notify_failed", error=str(e), owner_id=owner_id)
