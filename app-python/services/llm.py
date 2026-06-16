from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from app.settings import Settings


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMResponse:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)
    raw_message: dict[str, Any] = field(default_factory=dict)
    latency_ms: int = 0
    model: str = ""


class LLMRequestError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, model: str = "", detail: str = ""):
        self.status_code = status_code
        self.model = model
        self.detail = detail
        super().__init__(message)


class LLMClient:
    def __init__(self, settings: Settings, db: Any = None):
        self.settings = settings
        self.db = db

    def resolve_model(self, task_class: str, user_id: str | None = None) -> str:
        routing = self._get_model_routing_config()
        classes = routing.get("classes", {})

        target = classes.get(task_class)
        if not target:
            if task_class == "lite":
                target = self.settings.lite_model
            else:
                target = self.settings.llm_model

        if task_class == "deep":
            max_deep = int(routing.get("max_deep_calls_per_day") or 200)
            if self.db:
                from datetime import UTC, datetime
                start_of_day = datetime.now(UTC).date().isoformat() + "T00:00:00Z"
                try:
                    with self.db.connect() as conn:
                        row = conn.execute(
                            "SELECT COUNT(*) AS count FROM llm_calls WHERE purpose='deep' AND created_at >= ?",
                            (start_of_day,)
                        ).fetchone()
                    count = row["count"] if row else 0
                    if count >= max_deep:
                        fallback_model = classes.get("agent") or self.settings.llm_model
                        try:
                            with self.db.connect() as conn:
                                conn.execute("PRAGMA busy_timeout=1000")
                                conn.execute(
                                    "INSERT INTO audit_log(actor, action, target, detail, created_at) VALUES (?,?,?,?,?)",
                                    (
                                        user_id or "system",
                                        "deep_budget_exceeded",
                                        "llm",
                                        '{"count":' + str(count) + ',"max":' + str(max_deep) + '}',
                                        datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
                                    )
                                )
                                conn.commit()
                        except Exception:
                            pass
                        return fallback_model
                except Exception:
                    pass
        return target

    def _get_model_routing_config(self) -> dict[str, Any]:
        if not self.db:
            return {}
        try:
            with self.db.connect() as conn:
                row = conn.execute("SELECT value FROM settings WHERE key=?", ("model_routing",)).fetchone()
            if row and row["value"]:
                import json
                return json.loads(row["value"])
        except Exception:
            pass
        return {}

    async def chat(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: int | None = None,
        user_id: str | None = None,
        task_class: str | None = None,
    ) -> LLMResponse:
        # Resolve target model
        if model in {"lite", "agent", "code", "deep"}:
            primary_model = self.resolve_model(model, user_id=user_id)
        else:
            primary_model = model

        routing = self._get_model_routing_config()
        fallback_chain = routing.get("fallback_chain") or []

        candidates = [primary_model]
        for m in fallback_chain:
            if m and m not in candidates:
                candidates.append(m)
        if model in {"lite", "agent", "code", "deep"} and self.settings.llm_model and self.settings.llm_model not in candidates:
            candidates.append(self.settings.llm_model)

        last_error = None
        for candidate in candidates:
            try:
                resp = await self._chat_single(
                    model=candidate,
                    messages=messages,
                    tools=tools,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                )
                resp.model = candidate
                return resp
            except Exception as exc:
                last_error = exc
                if _error_status_code(exc) == 404:
                    self._record_model_routing_stale(candidate, primary_model, task_class or model, user_id)
                if _is_non_fallback_error(exc):
                    raise
                continue
        raise RuntimeError(f"All candidate models failed. Last error: {last_error}") from last_error

    def _record_model_routing_stale(
        self,
        failed_model: str,
        primary_model: str,
        task_class: str | None,
        user_id: str | None,
    ) -> None:
        if not self.db:
            return
        try:
            with self.db.connect() as conn:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute(
                    "INSERT INTO audit_log(actor, action, target, detail, created_at) VALUES (?,?,?,?,?)",
                    (
                        user_id or "system",
                        "model_routing_stale",
                        "llm",
                        json.dumps(
                            {
                                "failed_model": failed_model,
                                "primary_model": primary_model,
                                "task_class": task_class,
                                "status_code": 404,
                            },
                            ensure_ascii=False,
                        ),
                        datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    ),
                )
                conn.commit()
        except Exception:
            pass

    async def _chat_single(
        self,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: int | None = None,
    ) -> LLMResponse:
        if not self.settings.llm_base_url or not model:
            raise RuntimeError("LLM is not configured")
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {"Content-Type": "application/json"}
        if self.settings.llm_api_key:
            headers["Authorization"] = f"Bearer {self.settings.llm_api_key}"

        url = f"{self.settings.llm_base_url}/chat/completions"
        delays = [0, 2, 8]
        last_error: Exception | None = None
        started = time.perf_counter()
        deadline = started + (timeout or self.settings.llm_timeout_seconds)
        for delay in delays:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                break
            if delay:
                await asyncio.sleep(min(delay, max(0, remaining)))
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                break
            try:
                async with httpx.AsyncClient(timeout=max(1.0, remaining)) as client:
                    resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code in {429, 500, 502, 503, 504}:
                    retry_after = resp.headers.get("retry-after")
                    detail = _response_error_detail(resp)
                    last_error = LLMRequestError(
                        f"LLM transient HTTP {resp.status_code}"
                        + (f" retry_after={retry_after}" if retry_after else "")
                        + (f" detail={detail}" if detail else ""),
                        status_code=resp.status_code,
                        model=model,
                        detail=detail,
                    )
                    continue
                resp.raise_for_status()
                data = resp.json()
                latency_ms = int((time.perf_counter() - started) * 1000)
                return self._parse(data, latency_ms)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = RuntimeError(f"{exc.__class__.__name__}: {str(exc) or 'no detail'}")
                continue
            except httpx.HTTPStatusError as exc:
                detail = _response_error_detail(exc.response)
                status_code = exc.response.status_code
                raise LLMRequestError(
                    f"LLM HTTP {status_code}" + (f" detail={detail}" if detail else ""),
                    status_code=status_code,
                    model=model,
                    detail=detail,
                ) from exc
        if isinstance(last_error, LLMRequestError):
            raise last_error
        raise RuntimeError(f"LLM request failed within {timeout or self.settings.llm_timeout_seconds}s: {last_error}") from last_error

    def _parse(self, data: dict[str, Any], latency_ms: int) -> LLMResponse:
        choice = data.get("choices", [{}])[0]
        message = choice.get("message") or {}
        content = _content_to_text(message.get("content"))
        tool_calls: list[ToolCall] = []
        for call in message.get("tool_calls") or []:
            fn = call.get("function") or {}
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                import json

                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}
            tool_calls.append(ToolCall(id=call.get("id") or fn.get("name") or "tool", name=fn.get("name") or "", arguments=args))
        usage = data.get("usage") or {}
        return LLMResponse(content=content, tool_calls=tool_calls, usage=usage, raw_message=message, latency_ms=latency_ms)


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if "text" in item:
                    parts.append(str(item["text"]))
                elif item.get("type") == "text" and "content" in item:
                    parts.append(str(item["content"]))
        return "".join(parts)
    return ""


def _response_error_detail(resp: httpx.Response, limit: int = 200) -> str:
    try:
        text = resp.text
    except Exception:
        return ""
    return " ".join(text.split())[:limit]


def _is_non_fallback_error(exc: Exception) -> bool:
    status_code = _error_status_code(exc)
    if status_code is not None:
        return status_code in {400, 401, 403, 422}
    text = str(exc).lower()
    if "llm is not configured" in text or "not configured" in text:
        return True
    if re.search(r"\b(?:400|401|403|422)\b", text):
        return True
    if any(marker in text for marker in ("unauthorized", "forbidden", "invalid api key", "authentication")):
        return True
    return False


def _error_status_code(exc: Exception) -> int | None:
    if isinstance(exc, LLMRequestError):
        return exc.status_code
    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int):
        return status_code
    return None
