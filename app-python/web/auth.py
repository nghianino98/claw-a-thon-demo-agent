from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request

from app.settings import Settings

ROLE_LEVELS = {"viewer": 0, "operator": 1, "superadmin": 2}


def direct_api_authorized(settings: Settings, api_key: str | None, authorization: str | None) -> bool:
    if not settings.agent_api_key:
        return False
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    provided = api_key or bearer
    return bool(provided and hmac.compare_digest(provided, settings.agent_api_key))


def _bearer_token(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def admin_authorized(settings: Settings, authorization: str | None) -> bool:
    if not settings.agent_admin_token:
        return False
    token = _bearer_token(authorization)
    return bool(token and hmac.compare_digest(token, settings.agent_admin_token))


def admin_role_allowed(acting_role: str | None, minimum_role: str) -> bool:
    role_level = ROLE_LEVELS.get((acting_role or "").strip().lower())
    minimum_level = ROLE_LEVELS[minimum_role]
    return role_level is not None and role_level >= minimum_level


def sync_authorized(settings: Settings, api_key: str | None) -> bool:
    if not settings.sync_api_key:
        return False
    return bool(api_key and hmac.compare_digest(api_key, settings.sync_api_key))


async def require_agent_auth(
    request: Request,
    x_agent_api_key: str | None = Header(None, alias="X-Agent-Api-Key"),
    authorization: str | None = Header(None, alias="Authorization"),
) -> None:
    settings: Settings = request.app.state.settings
    if not direct_api_authorized(settings, x_agent_api_key, authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def require_admin_auth(
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
    x_acting_user: str | None = Header(None, alias="X-Acting-User"),
    x_acting_role: str | None = Header(None, alias="X-Acting-Role"),
) -> None:
    await _require_admin_role(request, authorization, x_acting_user, x_acting_role, "viewer")


async def require_admin_operator(
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
    x_acting_user: str | None = Header(None, alias="X-Acting-User"),
    x_acting_role: str | None = Header(None, alias="X-Acting-Role"),
) -> None:
    await _require_admin_role(request, authorization, x_acting_user, x_acting_role, "operator")


async def require_admin_superadmin(
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
    x_acting_user: str | None = Header(None, alias="X-Acting-User"),
    x_acting_role: str | None = Header(None, alias="X-Acting-Role"),
) -> None:
    await _require_admin_role(request, authorization, x_acting_user, x_acting_role, "superadmin")


async def require_sync_auth(
    request: Request,
    x_sync_api_key: str | None = Header(None, alias="X-Sync-Api-Key"),
) -> None:
    settings: Settings = request.app.state.settings
    if not settings.sync_api_key:
        raise HTTPException(status_code=404, detail="Not found")
    if not sync_authorized(settings, x_sync_api_key):
        raise HTTPException(status_code=401, detail="Unauthorized")
    request.state.auth_actor = "sync-api"


async def require_sync_or_admin_auth(
    request: Request,
    x_sync_api_key: str | None = Header(None, alias="X-Sync-Api-Key"),
    authorization: str | None = Header(None, alias="Authorization"),
    x_acting_user: str | None = Header(None, alias="X-Acting-User"),
    x_acting_role: str | None = Header(None, alias="X-Acting-Role"),
) -> None:
    settings: Settings = request.app.state.settings
    if settings.sync_api_key and sync_authorized(settings, x_sync_api_key):
        request.state.auth_actor = "sync-api"
        return
    await _require_admin_role(request, authorization, x_acting_user, x_acting_role, "viewer")


async def require_sync_or_admin_operator(
    request: Request,
    x_sync_api_key: str | None = Header(None, alias="X-Sync-Api-Key"),
    authorization: str | None = Header(None, alias="Authorization"),
    x_acting_user: str | None = Header(None, alias="X-Acting-User"),
    x_acting_role: str | None = Header(None, alias="X-Acting-Role"),
) -> None:
    settings: Settings = request.app.state.settings
    if settings.sync_api_key and sync_authorized(settings, x_sync_api_key):
        request.state.auth_actor = "sync-api"
        return
    await _require_admin_role(request, authorization, x_acting_user, x_acting_role, "operator")


async def _require_admin_role(
    request: Request,
    authorization: str | None,
    acting_user: str | None,
    acting_role: str | None,
    minimum_role: str,
) -> None:
    settings: Settings = request.app.state.settings
    if not admin_authorized(settings, authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not acting_user or not acting_role:
        raise HTTPException(status_code=401, detail="Missing acting user or role")
    if not admin_role_allowed(acting_role, minimum_role):
        raise HTTPException(status_code=403, detail="forbidden")
    request.state.auth_actor = f"didi:{acting_user}"
    request.state.auth_role = acting_role.strip().lower()
