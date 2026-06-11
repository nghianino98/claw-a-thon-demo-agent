from __future__ import annotations

import asyncio
import json
import hmac
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Form
from fastapi import UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app import __version__
from app.channels.base import IncomingMessage
from app.channels.telegram.adapter import TelegramAdapter
from app.channels.telegram.client import TelegramClient
from app.channels.telegram.polling import polling_loop
from app.core.agent_loop import AgentLoop
from app.core.prompts import PromptBuilder
from app.core.router import MessageRouter
from app.core.tools import ToolRegistry
from app.core.workflows import WorkflowEngine
from app.db import Database, run_migrations
from app.services.access import AccessService
from app.services.audit import AuditService
from app.services.backup import BackupService
from app.services.config import ConfigService
from app.services.guardrail import GuardrailService
from app.services.kb import KBService
from app.services.llm import LLMClient
from app.services.memory import MemoryService
from app.services.rate_limit import RateLimiter
from app.services.registry import SkillRegistry, WorkflowRegistry
from app.settings import Settings, get_settings
from app.utils import log_event, setup_logging, utc_now
from app.web.auth import (
    require_admin_auth,
    require_admin_operator,
    require_admin_superadmin,
    require_agent_auth,
    require_sync_or_admin_auth,
    require_sync_or_admin_operator,
)


@dataclass
class Services:
    db: Database
    audit: AuditService
    config: ConfigService
    memory: MemoryService
    access: AccessService
    rate_limit: RateLimiter
    kb: KBService
    skills: SkillRegistry
    workflow_registry: WorkflowRegistry
    llm: LLMClient
    tools: ToolRegistry
    prompts: PromptBuilder
    agent_loop: AgentLoop
    router: MessageRouter
    workflows: WorkflowEngine
    telegram_client: TelegramClient
    telegram_adapter: TelegramAdapter
    backup: BackupService
    guardrail: GuardrailService


class InvocationRequest(BaseModel):
    message: str
    user_id: str | None = None
    session_id: str | None = None


class InstructionRequest(BaseModel):
    content: str
    name: str = "persona"


class SettingPatch(BaseModel):
    values: dict[str, str]


class ChunkedUploadStart(BaseModel):
    filename: str
    total_parts: int
    activate: bool = True


def auth_actor(request: Request, fallback: str = "system") -> str:
    return str(getattr(request.state, "auth_actor", fallback))


def build_services(settings: Settings) -> Services:
    settings.state_dir.mkdir(parents=True, exist_ok=True)
    setup_logging(settings.log_level)
    db = Database(settings.db_path)
    run_migrations(db)
    audit = AuditService(db)
    config = ConfigService(db, Path("config/persona.md"))
    guardrail = GuardrailService(settings)
    memory = MemoryService(db)
    access = AccessService(db, settings)
    access.seed_from_env()
    rate_limit = RateLimiter(db, settings)
    telegram_client = TelegramClient(settings.telegram_bot_token)
    skills = SkillRegistry(db, settings.kb_dir / "current")
    workflow_registry = WorkflowRegistry(db, settings.kb_dir / "current")
    kb = KBService(
        db,
        settings,
        audit=audit,
        skill_registry=skills,
        workflow_registry=workflow_registry,
        telegram_client=telegram_client,
    )
    kb.ensure_dirs()
    if (settings.kb_dir / "current").exists():
        kb.reload_registries()
    backup = BackupService(db, settings)
    llm = LLMClient(settings)
    tools = ToolRegistry(settings, kb, memory, skills)
    prompts = PromptBuilder(settings, config, memory, skills)
    agent_loop = AgentLoop(settings, db, llm, memory, tools, prompts, audit)
    router = MessageRouter(agent_loop, skills, workflow_registry, audit, guardrail)
    workflows = WorkflowEngine(settings, db, workflow_registry, agent_loop, audit)
    telegram_adapter = TelegramAdapter(
        telegram_client,
        access,
        router,
        workflows,
        kb,
        memory,
        skills,
        workflow_registry,
        audit,
    )
    return Services(
        db,
        audit,
        config,
        memory,
        access,
        rate_limit,
        kb,
        skills,
        workflow_registry,
        llm,
        tools,
        prompts,
        agent_loop,
        router,
        workflows,
        telegram_client,
        telegram_adapter,
        backup,
        guardrail,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db_path = settings.db_path
        db_exists = db_path.exists()

        db_exists = db_path.exists()
        if not db_exists and settings.s3_endpoint:
            try:
                setup_logging(settings.log_level)
                log_event("info", "boot_restore_started")
                db = Database(settings.db_path)
                backup_service = BackupService(db, settings)
                restored = backup_service.restore()
                if restored:
                    log_event("info", "boot_restore_succeeded")
                else:
                    log_event("info", "boot_restore_no_backup")
            except Exception as e:
                log_event("error", "boot_restore_failed", error=str(e))

        services = build_services(settings)
        app.state.settings = settings
        app.state.services = services

        backup_task: asyncio.Task | None = None
        if services.backup.enabled:
            async def backup_scheduler():
                while True:
                    interval = max(1, settings.backup_interval_hours) * 3600
                    await asyncio.sleep(interval)
                    try:
                        log_event("info", "scheduled_backup_started")
                        services.backup.backup()
                    except Exception as e:
                        log_event("error", "scheduled_backup_failed", error=str(e))
            backup_task = asyncio.create_task(backup_scheduler())
            log_event("info", "scheduled_backup_started_task")

        polling_task: asyncio.Task | None = None
        if settings.telegram_mode == "polling" and settings.telegram_bot_token:
            polling_task = asyncio.create_task(polling_loop(services.telegram_client, services.telegram_adapter))
            log_event("info", "telegram_polling_started")
        yield
        if backup_task:
            backup_task.cancel()
        if polling_task:
            polling_task.cancel()

    app = FastAPI(title="Quéo Solution Agent", version=__version__, lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"status": "error", "error": str(exc.detail)})

    @app.exception_handler(Exception)
    async def exception_handler(_request: Request, exc: Exception):
        log_event("error", "unhandled_exception", error=str(exc))
        return JSONResponse(status_code=500, content={"status": "error", "error": "Internal server error"})

    @app.get("/health")
    async def health(request: Request):
        services: Services = request.app.state.services
        return {"status": "ok", "version": __version__, "kb_version": services.kb.active_version()}

    @app.post("/invocations", dependencies=[Depends(require_agent_auth)])
    async def invocations(
        request: Request,
        body: InvocationRequest,
        x_user_id: str | None = Header(None, alias="X-GreenNode-AgentBase-User-Id"),
        x_session_id: str | None = Header(None, alias="X-GreenNode-AgentBase-Session-Id"),
    ):
        if not body.message.strip():
            raise HTTPException(status_code=400, detail="Message is required.")
        services: Services = request.app.state.services
        user_id = x_user_id or body.user_id or "default-user"
        session_id = x_session_id or body.session_id or "default-session"
        if not services.rate_limit.check(user_id):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        reply = await services.router.handle(
            IncomingMessage(user_id=user_id, session_id=session_id, text=body.message, channel="direct", actor=user_id)
        )
        return {
            "status": "success",
            "response": reply.text,
            "citations": reply.citations,
            "artifacts": reply.artifacts,
            "mode": reply.mode,
            "agent_name": request.app.state.settings.agent_name,
            "timestamp": utc_now(),
        }

    @app.post("/telegram/webhook/{secret}")
    async def telegram_webhook(
        request: Request,
        secret: str,
        x_secret: str | None = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
    ):
        settings: Settings = request.app.state.settings
        if not settings.telegram_bot_token:
            raise HTTPException(status_code=503, detail="Telegram is not configured")
        if not settings.telegram_webhook_secret:
            raise HTTPException(status_code=404, detail="Not found")
        if not hmac.compare_digest(secret, settings.telegram_webhook_secret):
            raise HTTPException(status_code=404, detail="Not found")
        if not x_secret or not hmac.compare_digest(x_secret, settings.telegram_webhook_secret):
            raise HTTPException(status_code=404, detail="Not found")
        update = await request.json()
        services: Services = request.app.state.services
        await services.telegram_adapter.handle_update(update)
        return {"status": "accepted"}

    @app.get("/admin/api/status", dependencies=[Depends(require_admin_auth)])
    async def admin_status(request: Request):
        services: Services = request.app.state.services
        return {
            "status": "success",
            "app_version": __version__,
            "kb": services.kb.status(),
            "skills": len(services.skills.list_enabled()),
            "workflows": len(services.workflow_registry.list_enabled()),
            "runs": len(services.workflows.tasks),
            "admin_ui": "deferred",
        }

    @app.get("/admin/api/instructions", dependencies=[Depends(require_admin_auth)])
    async def get_instructions(request: Request, name: str = "persona"):
        services: Services = request.app.state.services
        with services.db.connect() as conn:
            rows = conn.execute(
                "SELECT id, name, version, active, created_at, created_by FROM instructions WHERE name=? ORDER BY version DESC",
                (name,),
            ).fetchall()
        return {"status": "success", "instructions": [dict(row) for row in rows]}

    @app.post("/admin/api/instructions", dependencies=[Depends(require_admin_operator)])
    async def set_instruction(request: Request, body: InstructionRequest):
        services: Services = request.app.state.services
        actor = auth_actor(request, "admin-api")
        instruction_id = services.config.set_instruction(body.name, body.content, actor)
        services.audit.record(actor, "instruction_update", body.name, {"id": instruction_id})
        return {"status": "success", "id": instruction_id}

    @app.post("/admin/api/instructions/{instruction_id}/activate", dependencies=[Depends(require_admin_operator)])
    async def activate_instruction(request: Request, instruction_id: int):
        services: Services = request.app.state.services
        actor = auth_actor(request, "admin-api")
        with services.db.connect() as conn:
            row = conn.execute("SELECT name FROM instructions WHERE id=?", (instruction_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Instruction not found")
            conn.execute("UPDATE instructions SET active=0 WHERE name=?", (row["name"],))
            conn.execute("UPDATE instructions SET active=1 WHERE id=?", (instruction_id,))
            conn.commit()
        services.audit.record(actor, "instruction_activate", str(instruction_id), {"name": row["name"]})
        return {"status": "success", "id": instruction_id}

    @app.get("/admin/api/skills", dependencies=[Depends(require_admin_auth)])
    async def admin_skills(request: Request):
        services: Services = request.app.state.services
        return {"status": "success", "skills": [skill.__dict__ for skill in services.skills.list_enabled()]}

    @app.get("/admin/api/workflows", dependencies=[Depends(require_admin_auth)])
    async def admin_workflows(request: Request):
        services: Services = request.app.state.services
        return {"status": "success", "workflows": [workflow.__dict__ for workflow in services.workflow_registry.list_enabled()]}

    @app.get("/admin/api/kb", dependencies=[Depends(require_admin_auth)])
    async def admin_kb_versions(request: Request):
        services: Services = request.app.state.services
        return {"status": "success", "versions": services.kb.versions()}

    @app.get("/admin/api/kb/{version_id:int}", dependencies=[Depends(require_admin_auth)])
    async def admin_kb_version(request: Request, version_id: int):
        services: Services = request.app.state.services
        with services.db.connect() as conn:
            row = conn.execute("SELECT * FROM kb_versions WHERE id=?", (version_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="KB version not found")
        return {"status": "success", "version": dict(row)}

    @app.post("/admin/api/kb/{version_id:int}/activate", dependencies=[Depends(require_admin_operator)])
    async def admin_kb_activate(request: Request, version_id: int, background_tasks: BackgroundTasks):
        services: Services = request.app.state.services
        services.kb.activate_version(version_id)
        if services.backup.enabled:
            background_tasks.add_task(services.backup.backup)
        return {"status": "success"}

    @app.post("/admin/api/kb/search-test", dependencies=[Depends(require_admin_auth)])
    async def admin_kb_search(request: Request, body: dict[str, Any]):
        services: Services = request.app.state.services
        hits = services.kb.search(body.get("query", ""), body.get("product"), body.get("area"), int(body.get("top_k") or 5))
        return {"status": "success", "results": [hit.as_dict() for hit in hits]}

    @app.post("/admin/api/kb/upload", dependencies=[Depends(require_admin_operator)])
    async def admin_kb_upload(
        request: Request,
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        activate: bool = True,
    ):
        services: Services = request.app.state.services
        if not file.filename or not file.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Only .zip uploads are supported")
        upload_dir = request.app.state.settings.state_dir / "uploads" / "tmp"
        upload_dir.mkdir(parents=True, exist_ok=True)
        upload_path = upload_dir / f"{utc_now().replace(':', '').replace('-', '')}-{Path(file.filename).name}"
        size = 0
        max_size = request.app.state.settings.kb_upload_max_mb * 1024 * 1024
        with upload_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_size:
                    upload_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Upload exceeds KB_UPLOAD_MAX_MB")
                handle.write(chunk)

        def process_upload() -> None:
            try:
                services.kb.build_from_zip(upload_path, uploaded_by=auth_actor(request, "admin-api"), activate=activate)
            finally:
                upload_path.unlink(missing_ok=True)

        background_tasks.add_task(process_upload)
        services.audit.record(auth_actor(request, "admin-api"), "kb_upload_requested", file.filename, {"activate": activate, "bytes": size})
        return {"status": "accepted", "filename": file.filename, "bytes": size, "activate": activate}

    @app.post("/admin/api/kb/chunked/start", dependencies=[Depends(require_admin_operator)])
    async def admin_kb_chunked_start(request: Request, body: ChunkedUploadStart):
        if body.total_parts < 1 or body.total_parts > 1000:
            raise HTTPException(status_code=400, detail="Invalid total_parts")
        if not body.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Only .zip uploads are supported")
        upload_id = uuid.uuid4().hex
        upload_dir = request.app.state.settings.state_dir / "uploads" / "tmp" / upload_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "filename": Path(body.filename).name,
            "total_parts": body.total_parts,
            "activate": body.activate,
            "created_at": utc_now(),
        }
        (upload_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        request.app.state.services.audit.record(auth_actor(request, "admin-api"), "kb_chunked_upload_start", upload_id, meta)
        return {"status": "success", "upload_id": upload_id}

    @app.post("/admin/api/kb/chunked/{upload_id}/part/{part_no}", dependencies=[Depends(require_admin_operator)])
    async def admin_kb_chunked_part(request: Request, upload_id: str, part_no: int, file: UploadFile = File(...)):
        if not upload_id.isalnum():
            raise HTTPException(status_code=400, detail="Invalid upload_id")
        upload_dir = request.app.state.settings.state_dir / "uploads" / "tmp" / upload_id
        meta_path = upload_dir / "meta.json"
        if not meta_path.exists():
            raise HTTPException(status_code=404, detail="Upload not found")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        total_parts = int(meta["total_parts"])
        if part_no < 0 or part_no >= total_parts:
            raise HTTPException(status_code=400, detail="Invalid part_no")
        part_path = upload_dir / f"part-{part_no:05d}"
        size = 0
        max_part_size = 80 * 1024 * 1024
        with part_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > max_part_size:
                    part_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Part too large")
                handle.write(chunk)
        return {"status": "success", "upload_id": upload_id, "part_no": part_no, "bytes": size}

    @app.post("/admin/api/kb/chunked/{upload_id}/complete", dependencies=[Depends(require_admin_operator)])
    async def admin_kb_chunked_complete(request: Request, background_tasks: BackgroundTasks, upload_id: str):
        if not upload_id.isalnum():
            raise HTTPException(status_code=400, detail="Invalid upload_id")
        services: Services = request.app.state.services
        upload_dir = request.app.state.settings.state_dir / "uploads" / "tmp" / upload_id
        meta_path = upload_dir / "meta.json"
        if not meta_path.exists():
            raise HTTPException(status_code=404, detail="Upload not found")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        total_parts = int(meta["total_parts"])
        missing = [idx for idx in range(total_parts) if not (upload_dir / f"part-{idx:05d}").exists()]
        if missing:
            raise HTTPException(status_code=409, detail=f"Missing parts: {missing[:10]}")
        merged = upload_dir / meta["filename"]
        with merged.open("wb") as out:
            for idx in range(total_parts):
                with (upload_dir / f"part-{idx:05d}").open("rb") as part:
                    import shutil

                    shutil.copyfileobj(part, out, length=1024 * 1024)

        def process_chunked_upload() -> None:
            try:
                services.kb.build_from_zip(merged, uploaded_by=auth_actor(request, "admin-api"), activate=bool(meta.get("activate", True)))
            finally:
                import shutil

                shutil.rmtree(upload_dir, ignore_errors=True)

        background_tasks.add_task(process_chunked_upload)
        services.audit.record(auth_actor(request, "admin-api"), "kb_chunked_upload_complete", upload_id, {"filename": meta["filename"], "parts": total_parts})
        return {"status": "accepted", "upload_id": upload_id, "filename": meta["filename"], "parts": total_parts}

    @app.get("/admin/api/access", dependencies=[Depends(require_admin_auth)])
    async def admin_access(request: Request, status: str | None = None):
        services: Services = request.app.state.services
        return {"status": "success", "users": services.access.users(status=status)}

    @app.post("/admin/api/access/{tg_user_id}", dependencies=[Depends(require_admin_operator)])
    async def admin_set_access(request: Request, tg_user_id: int, body: dict[str, Any]):
        services: Services = request.app.state.services
        status = str(body.get("status") or "")
        note = body.get("note")
        if status not in {"allowed", "rejected", "revoked", "pending"}:
            raise HTTPException(status_code=400, detail="Invalid access status")
        actor = auth_actor(request, "admin-api")
        services.access.set_status(tg_user_id, status, actor, str(note) if note is not None else None)
        services.audit.record(actor, "access_update", str(tg_user_id), {"status": status})
        return {"status": "success", "user_id": tg_user_id, "access_status": status}

    @app.get("/admin/api/audit", dependencies=[Depends(require_admin_auth)])
    async def admin_audit(request: Request, limit: int = 50):
        services: Services = request.app.state.services
        return {"status": "success", "audit": services.audit.recent(limit)}

    @app.get("/admin/api/answers", dependencies=[Depends(require_admin_auth)])
    async def admin_answers(request: Request, limit: int = 50, user_id: str | None = None, session_id: str | None = None):
        services: Services = request.app.state.services
        return {"status": "success", "answers": services.audit.answers(limit, user_id=user_id, session_id=session_id)}

    @app.get("/admin/api/settings", dependencies=[Depends(require_admin_auth)])
    async def admin_get_settings(request: Request):
        services: Services = request.app.state.services
        with services.db.connect() as conn:
            rows = conn.execute("SELECT key, value, updated_at, updated_by FROM settings ORDER BY key").fetchall()
        return {"status": "success", "settings": [dict(row) for row in rows]}

    @app.patch("/admin/api/settings", dependencies=[Depends(require_admin_superadmin)])
    async def admin_patch_settings(request: Request, body: dict[str, Any]):
        services: Services = request.app.state.services
        actor = auth_actor(request, "admin-api")
        values = body.get("values", body)
        if not isinstance(values, dict):
            raise HTTPException(status_code=400, detail="Invalid settings payload")
        allowed = {
            "kb_sync_activate",
            "workflow_enabled",
            "model_routing",
            "registry_version",
            "rate_limit_per_minute",
            "rate_limit_per_day",
        }
        changed: dict[str, str] = {}
        for key, value in values.items():
            if key not in allowed:
                raise HTTPException(status_code=400, detail=f"Setting is not writable: {key}")
            val = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
            services.config.set_setting(key, val, actor)
            changed[key] = val
        services.audit.record(actor, "settings_update", "settings", {"keys": sorted(changed)})
        return {"status": "success", "settings": changed}

    @app.get("/admin/api/kb/manifest", dependencies=[Depends(require_sync_or_admin_auth)])
    async def kb_manifest(request: Request):
        services: Services = request.app.state.services
        return services.kb.manifest()

    @app.get("/admin/api/kb/sync-status", dependencies=[Depends(require_sync_or_admin_auth)])
    async def kb_sync_status(request: Request):
        services: Services = request.app.state.services
        with services.db.connect() as conn:
            row = conn.execute("SELECT * FROM sync_state WHERE id=1").fetchone()
        sync_data = dict(row) if row else {
            "last_sync_at": None,
            "last_client_host": None,
            "last_result": None,
            "last_error": None
        }
        return {"status": "success", "sync": sync_data, "kb": services.kb.status()}

    @app.post("/admin/api/kb/delta", dependencies=[Depends(require_sync_or_admin_operator)])
    async def kb_delta(
        request: Request,
        background_tasks: BackgroundTasks,
        meta: str = Form(...),
        archive: UploadFile = File(...),
    ):
        services: Services = request.app.state.services
        try:
            meta_data = json.loads(meta)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid meta JSON: {str(e)}")

        active_version = services.kb.active_version()
        base_version = meta_data.get("base_version")
        if base_version is None or active_version is None or int(base_version) != active_version:
            raise HTTPException(status_code=409, detail=f"Base version mismatch. Client base: {base_version}, active: {active_version}")

        with services.db.connect() as conn:
            processing = conn.execute("SELECT id FROM kb_versions WHERE status='processing' LIMIT 1").fetchone()
        if processing:
            raise HTTPException(status_code=409, detail="A KB version is already being processed")

        if not archive.filename or not archive.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Only .zip uploads are supported")
        upload_dir = request.app.state.settings.state_dir / "uploads" / "tmp"
        upload_dir.mkdir(parents=True, exist_ok=True)
        upload_path = upload_dir / f"{utc_now().replace(':', '').replace('-', '')}-delta-{Path(archive.filename).name}"

        size = 0
        max_size = request.app.state.settings.kb_delta_max_mb * 1024 * 1024
        with upload_path.open("wb") as handle:
            while chunk := await archive.read(1024 * 1024):
                size += len(chunk)
                if size > max_size:
                    upload_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Delta archive exceeds KB_DELTA_MAX_MB")
                handle.write(chunk)

        async def process_delta_task() -> None:
            try:
                await services.kb.apply_delta(upload_path, meta_data, uploaded_by=auth_actor(request, "sync-api"))
                if services.backup.enabled:
                    services.backup.backup()
            except Exception as e:
                log_event("error", "delta_sync_failed", error=str(e))
            finally:
                upload_path.unlink(missing_ok=True)

        background_tasks.add_task(process_delta_task)
        services.audit.record(auth_actor(request, "sync-api"), "kb_delta_requested", archive.filename, {"base_version": base_version, "bytes": size})
        return {"status": "success", "message": "Delta sync accepted", "bytes": size}

    @app.get("/admin/api/runs", dependencies=[Depends(require_admin_auth)])
    async def admin_runs(request: Request, limit: int = 50):
        services: Services = request.app.state.services
        return {"status": "success", "runs": services.workflows.recent_runs(limit)}

    @app.get("/admin/api/runs/{run_id}", dependencies=[Depends(require_admin_auth)])
    async def admin_run_detail(request: Request, run_id: int):
        services: Services = request.app.state.services
        with services.db.connect() as conn:
            row = conn.execute("SELECT * FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Run not found")
        return {"status": "success", "run": dict(row)}

    @app.post("/admin/api/runs/{run_id}/cancel", dependencies=[Depends(require_admin_operator)])
    async def admin_run_cancel(request: Request, run_id: int):
        services: Services = request.app.state.services
        cancelled = await services.workflows.cancel(run_id, auth_actor(request, "admin-api"))
        if not cancelled:
            raise HTTPException(status_code=404, detail="Run not found or cannot be cancelled")
        return {"status": "success"}

    @app.get("/admin/api/runs/{run_id}/artifacts/{filename}", dependencies=[Depends(require_admin_auth)])
    async def admin_run_artifact(request: Request, run_id: int, filename: str):
        if not filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        path = request.app.state.settings.artifacts_dir / str(run_id) / filename
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="Artifact not found")
        return FileResponse(path)

    @app.post("/admin/api/workflows/{workflow_id}/run", dependencies=[Depends(require_admin_operator)])
    async def admin_workflow_run(request: Request, workflow_id: str, body: dict[str, Any] | None = None):
        services: Services = request.app.state.services
        raw_params = json.dumps((body or {}).get("params", body or {}), ensure_ascii=False)
        run_id = await services.workflows.start(workflow_id, raw_params, "admin", auth_actor(request, "admin-api"), None)
        return {"status": "success", "run_id": run_id}

    @app.post("/admin/api/backup", dependencies=[Depends(require_admin_superadmin)])
    async def admin_backup(request: Request, background_tasks: BackgroundTasks):
        services: Services = request.app.state.services
        if not services.backup.enabled:
            raise HTTPException(status_code=400, detail="S3 backup is not configured/enabled")

        def run_backup():
            services.backup.backup()

        background_tasks.add_task(run_backup)
        return {"status": "success", "message": "Backup requested"}

    @app.get("/admin/api/backup", dependencies=[Depends(require_admin_auth)])
    async def admin_list_backups(request: Request):
        services: Services = request.app.state.services
        if not services.backup.enabled:
            return {"status": "success", "backups": []}
        backups = services.backup.list_backups()
        return {"status": "success", "backups": backups}

    @app.post("/admin/api/backup/restore", dependencies=[Depends(require_admin_superadmin)])
    async def admin_restore(request: Request, body: dict[str, Any]):
        services: Services = request.app.state.services
        if not services.backup.enabled:
            raise HTTPException(status_code=400, detail="S3 backup is not configured/enabled")

        if any(task for task in services.workflows.tasks.values() if task.status == "running"):
            raise HTTPException(status_code=409, detail="Cannot restore while workflows are running")

        key = body.get("key")
        try:
            success = services.backup.restore(key)
            if success:
                if (request.app.state.settings.kb_dir / "current").exists():
                    services.kb.reload_registries()
                return {"status": "success", "message": f"Successfully restored from {key or 'latest'}"}
            else:
                raise HTTPException(status_code=404, detail="No backup found to restore")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return app


app = create_app()
