from __future__ import annotations

import asyncio
import json
import os
import re
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from typing import Any

from app.core.tools.registry import ToolSpec
from app.db import Database
from app.services.crypto import SecretCipher
from app.settings import Settings
from app.utils import log_event, safe_json, utc_now

MAX_TOOL_NAME_LENGTH = 64
SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


@dataclass
class McpServerConfig:
    server_id: str
    name: str
    prefix: str
    transport: str
    command: str | None
    args: list[str]
    base_url: str | None
    env_public: dict[str, Any]
    enabled: bool
    status: str = "unknown"
    last_error: str | None = None
    last_checked_at: str | None = None
    tool_count: int = 0
    secret_keys: list[str] = field(default_factory=list)


@dataclass
class ConnectedMcpServer:
    config: McpServerConfig
    session: Any
    stack: AsyncExitStack
    tools: list[Any]

    @property
    def tool_names(self) -> list[str]:
        return [str(tool.name) for tool in self.tools]


class McpManager:
    def __init__(self, settings: Settings, db: Database, tools):
        self.settings = settings
        self.db = db
        self.tools = tools
        self.cipher = SecretCipher(settings)
        self._servers: dict[str, ConnectedMcpServer] = {}
        self._lock = asyncio.Lock()

    async def reload(self) -> None:
        async with self._lock:
            await self._disconnect_all()
            if not self.settings.mcp_enabled:
                return
            for config in self.list_servers():
                if not config.enabled:
                    self.tools.unregister_external_owner(self._owner(config.server_id))
                    continue
                try:
                    connected = await self._connect(config)
                    self._servers[config.server_id] = connected
                    self._register_tools(connected)
                    self._update_status(config.server_id, "connected", None, len(connected.tool_names))
                except Exception as exc:
                    self.tools.unregister_external_owner(self._owner(config.server_id))
                    self._update_status(config.server_id, "error", str(exc)[:1000], 0)
                    log_event("warning", "mcp_connect_failed", server_id=config.server_id, error=str(exc)[:300])

    async def shutdown(self) -> None:
        async with self._lock:
            await self._disconnect_all()

    def list_servers(self) -> list[McpServerConfig]:
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM mcp_servers ORDER BY name").fetchall()
            secrets = conn.execute("SELECT server_id, secret_key FROM mcp_secrets ORDER BY secret_key").fetchall()
        by_server: dict[str, list[str]] = {}
        for row in secrets:
            by_server.setdefault(str(row["server_id"]), []).append(str(row["secret_key"]))
        return [self._config_from_row(row, by_server.get(str(row["server_id"]), [])) for row in rows]

    def get_server(self, server_id: str) -> McpServerConfig | None:
        with self.db.connect() as conn:
            row = conn.execute("SELECT * FROM mcp_servers WHERE server_id=?", (server_id,)).fetchone()
            secrets = conn.execute(
                "SELECT secret_key FROM mcp_secrets WHERE server_id=? ORDER BY secret_key",
                (server_id,),
            ).fetchall()
        return self._config_from_row(row, [str(item["secret_key"]) for item in secrets]) if row else None

    def upsert_server(self, config: McpServerConfig, actor: str) -> None:
        if not SAFE_ID_RE.match(config.server_id) or not SAFE_ID_RE.match(config.prefix):
            raise ValueError("server_id and prefix must use letters, numbers, underscore, or hyphen")
        now = utc_now()
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO mcp_servers(
                  server_id, name, prefix, transport, command, args, base_url, env_public,
                  enabled, status, last_error, last_checked_at, tool_count, updated_at, updated_by
                )
                VALUES (?,?,?,?,?,?,?,?,?,'unknown',NULL,NULL,0,?,?)
                ON CONFLICT(server_id) DO UPDATE SET
                  name=excluded.name,
                  prefix=excluded.prefix,
                  transport=excluded.transport,
                  command=excluded.command,
                  args=excluded.args,
                  base_url=excluded.base_url,
                  env_public=excluded.env_public,
                  enabled=excluded.enabled,
                  status='unknown',
                  last_error=NULL,
                  tool_count=0,
                  updated_at=excluded.updated_at,
                  updated_by=excluded.updated_by
                """,
                (
                    config.server_id,
                    config.name,
                    config.prefix,
                    config.transport,
                    config.command,
                    safe_json(config.args),
                    config.base_url,
                    safe_json(config.env_public),
                    int(config.enabled),
                    now,
                    actor,
                ),
            )
            conn.commit()

    def delete_server(self, server_id: str) -> None:
        with self.db.connect() as conn:
            conn.execute("DELETE FROM mcp_servers WHERE server_id=?", (server_id,))
            conn.commit()
        self.tools.unregister_external_owner(self._owner(server_id))

    def set_secret(self, server_id: str, secret_key: str, value: str) -> None:
        if not SAFE_ID_RE.match(secret_key):
            raise ValueError("secret_key must use letters, numbers, underscore, or hyphen")
        encrypted = self.cipher.encrypt(value)
        with self.db.connect() as conn:
            exists = conn.execute("SELECT 1 FROM mcp_servers WHERE server_id=?", (server_id,)).fetchone()
            if not exists:
                raise KeyError(server_id)
            conn.execute(
                """
                INSERT INTO mcp_secrets(server_id, secret_key, value_encrypted, updated_at)
                VALUES (?,?,?,?)
                ON CONFLICT(server_id, secret_key) DO UPDATE SET
                  value_encrypted=excluded.value_encrypted,
                  updated_at=excluded.updated_at
                """,
                (server_id, secret_key, encrypted, utc_now()),
            )
            conn.commit()

    def loaded_tools(self, server_id: str) -> list[str]:
        connected = self._servers.get(server_id)
        return connected.tool_names if connected else []

    async def test_server(self, server_id: str) -> dict[str, Any]:
        config = self.get_server(server_id)
        if not config:
            raise KeyError(server_id)
        connected: ConnectedMcpServer | None = None
        try:
            connected = await self._connect(config)
            self._update_status(server_id, "connected", None, len(connected.tool_names))
            return {"status": "connected", "tool_count": len(connected.tool_names), "tools": connected.tool_names[:80]}
        except Exception as exc:
            self._update_status(server_id, "error", str(exc)[:1000], 0)
            return {"status": "error", "tool_count": 0, "tools": [], "error": str(exc)[:1000]}
        finally:
            if connected:
                await connected.stack.aclose()

    async def call_tool(self, server_id: str, tool_name: str, args: dict[str, Any]) -> str:
        connected = self._servers.get(server_id)
        if not connected:
            return safe_json({"error": f"MCP server is not connected: {server_id}"})
        try:
            result = await asyncio.wait_for(
                connected.session.call_tool(tool_name, args or {}),
                timeout=max(5, self.settings.mcp_call_timeout_seconds),
            )
            return self._serialize_tool_result(result)
        except Exception as exc:
            return safe_json({"error": str(exc)[:1000], "server_id": server_id, "tool": tool_name})

    async def _disconnect_all(self) -> None:
        for server_id, connected in list(self._servers.items()):
            self.tools.unregister_external_owner(self._owner(server_id))
            try:
                await connected.stack.aclose()
            except Exception as exc:
                log_event("warning", "mcp_disconnect_failed", server_id=server_id, error=str(exc)[:300])
        self._servers.clear()

    async def _connect(self, config: McpServerConfig) -> ConnectedMcpServer:
        try:
            from mcp import ClientSession
            from mcp.client.stdio import StdioServerParameters, stdio_client
            from mcp.client.streamable_http import streamable_http_client
        except Exception as exc:
            raise RuntimeError("Python package 'mcp' is not installed. Run pip install 'mcp>=1.27,<2'.") from exc

        env = self._runtime_env(config)
        stack = AsyncExitStack()
        if config.transport == "stdio":
            if not config.command:
                raise ValueError("stdio MCP server requires command")
            params = StdioServerParameters(command=config.command, args=config.args, env=env)
            read_stream, write_stream = await stack.enter_async_context(stdio_client(params))
        elif config.transport == "http":
            if not config.base_url:
                raise ValueError("http MCP server requires base_url")
            read_stream, write_stream, _ = await stack.enter_async_context(streamable_http_client(config.base_url))
        else:
            raise ValueError(f"Unsupported MCP transport: {config.transport}")

        session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
        await asyncio.wait_for(session.initialize(), timeout=max(5, self.settings.mcp_call_timeout_seconds))
        tools_response = await asyncio.wait_for(session.list_tools(), timeout=max(5, self.settings.mcp_call_timeout_seconds))
        mcp_tools = list(getattr(tools_response, "tools", []) or [])
        return ConnectedMcpServer(config=config, session=session, stack=stack, tools=mcp_tools)

    def _runtime_env(self, config: McpServerConfig) -> dict[str, str]:
        env = {key: str(value) for key, value in os.environ.items()}
        env.update({key: str(value) for key, value in config.env_public.items() if value is not None})
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT secret_key, value_encrypted FROM mcp_secrets WHERE server_id=?",
                (config.server_id,),
            ).fetchall()
        for row in rows:
            env[str(row["secret_key"])] = self.cipher.decrypt(row["value_encrypted"])
        return env

    def _register_tools(self, connected: ConnectedMcpServer) -> None:
        specs: list[ToolSpec] = []
        config = connected.config

        for tool in connected.tools:
            tool_name = str(tool.name)
            for exposed_name in self._exposed_tool_names(config, tool_name):
                specs.append(
                    ToolSpec(
                        name=exposed_name,
                        description=str(getattr(tool, "description", "") or f"MCP tool '{tool_name}' from {config.name}."),
                        parameters=self._tool_parameters(tool),
                        handler=self._handler(config.server_id, tool_name),
                    )
                )
        self.tools.register_external(self._owner(config.server_id), specs)

    def _handler(self, server_id: str, tool_name: str):
        async def handler(args: dict[str, Any], _ctx) -> str:
            return await self.call_tool(server_id, tool_name, args)

        return handler

    @staticmethod
    def _tool_parameters(tool: Any) -> dict[str, Any]:
        schema = getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None)
        if isinstance(schema, dict):
            return schema
        if hasattr(schema, "model_dump"):
            value = schema.model_dump(mode="json", by_alias=True)
            return value if isinstance(value, dict) else {"type": "object", "properties": {}}
        if hasattr(tool, "model_dump"):
            dumped = tool.model_dump(mode="json", by_alias=True)
            value = dumped.get("inputSchema") or dumped.get("input_schema")
            if isinstance(value, dict):
                return value
        return {"type": "object", "properties": {}, "additionalProperties": True}

    @staticmethod
    def _exposed_tool_names(config: McpServerConfig, tool_name: str) -> list[str]:
        candidates = [f"{config.prefix}__{tool_name}", f"mcp__{config.server_id}__{tool_name}"]
        out: list[str] = []
        for candidate in candidates:
            if len(candidate) <= MAX_TOOL_NAME_LENGTH and SAFE_ID_RE.match(candidate):
                out.append(candidate)
        return out

    @staticmethod
    def _serialize_tool_result(result: Any) -> str:
        content = getattr(result, "content", None)
        if isinstance(content, list):
            text_parts: list[str] = []
            other_parts: list[Any] = []
            for item in content:
                item_type = getattr(item, "type", None)
                if item_type == "text" and hasattr(item, "text"):
                    text_parts.append(str(item.text))
                elif hasattr(item, "model_dump"):
                    other_parts.append(item.model_dump(mode="json"))
                else:
                    other_parts.append(str(item))
            if text_parts and not other_parts:
                return "\n".join(text_parts)
            return safe_json({"text": "\n".join(text_parts), "content": other_parts, "is_error": bool(getattr(result, "isError", False))})
        if hasattr(result, "model_dump"):
            return safe_json(result.model_dump(mode="json"))
        return str(result)

    def _update_status(self, server_id: str, status: str, error: str | None, tool_count: int) -> None:
        with self.db.connect() as conn:
            conn.execute(
                """
                UPDATE mcp_servers
                SET status=?, last_error=?, last_checked_at=?, tool_count=?
                WHERE server_id=?
                """,
                (status, error, utc_now(), int(tool_count), server_id),
            )
            conn.commit()

    @staticmethod
    def _config_from_row(row: Any, secret_keys: list[str]) -> McpServerConfig:
        return McpServerConfig(
            server_id=str(row["server_id"]),
            name=str(row["name"]),
            prefix=str(row["prefix"]),
            transport=str(row["transport"]),
            command=str(row["command"]) if row["command"] else None,
            args=_loads_list(row["args"]),
            base_url=str(row["base_url"]) if row["base_url"] else None,
            env_public=_loads_dict(row["env_public"]),
            enabled=bool(row["enabled"]),
            status=str(row["status"] or "unknown"),
            last_error=str(row["last_error"]) if row["last_error"] else None,
            last_checked_at=str(row["last_checked_at"]) if row["last_checked_at"] else None,
            tool_count=int(row["tool_count"] or 0),
            secret_keys=secret_keys,
        )

    @staticmethod
    def _owner(server_id: str) -> str:
        return f"mcp:{server_id}"


def _loads_dict(raw: str | bytes | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _loads_list(raw: str | bytes | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except Exception:
        return []
    return [str(item) for item in value] if isinstance(value, list) else []
