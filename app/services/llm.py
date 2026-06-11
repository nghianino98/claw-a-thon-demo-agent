from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
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


class LLMClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def chat(
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
                    last_error = RuntimeError(
                        f"LLM transient HTTP {resp.status_code}"
                        + (f" retry_after={retry_after}" if retry_after else "")
                        + (f" detail={detail}" if detail else "")
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
                raise RuntimeError(f"LLM HTTP {exc.response.status_code}" + (f" detail={detail}" if detail else "")) from exc
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
