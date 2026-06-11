#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

import httpx


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("LLM_BASE_URL", "").rstrip("/"))
    parser.add_argument("--api-key", default=os.environ.get("LLM_API_KEY", ""))
    parser.add_argument("--model", default=os.environ.get("LLM_MODEL", ""))
    args = parser.parse_args()
    if not args.base_url or not args.model:
        print("Missing --base-url or --model", file=sys.stderr)
        return 2
    headers = {"Content-Type": "application/json"}
    if args.api_key:
        headers["Authorization"] = f"Bearer {args.api_key}"

    async with httpx.AsyncClient(timeout=60) as client:
        native = await probe_native(client, args.base_url, headers, args.model)
        json_mode = await probe_json(client, args.base_url, headers, args.model)
        vietnamese = await probe_vietnamese(client, args.base_url, headers, args.model)
    print(json.dumps({"native_tool_calling": native, "json_mode": json_mode, "vietnamese": vietnamese}, ensure_ascii=False, indent=2))
    return 0 if native or json_mode else 1


async def probe_native(client, base_url, headers, model) -> bool:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Mấy giờ rồi? Hãy gọi tool get_time."}],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_time",
                    "description": "Return current time",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ],
    }
    try:
        resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        data = resp.json()
        calls = data.get("choices", [{}])[0].get("message", {}).get("tool_calls") or []
        return bool(calls and calls[0].get("function", {}).get("name") == "get_time")
    except Exception:
        return False


async def probe_json(client, base_url, headers, model) -> bool:
    ok = 0
    for _ in range(5):
        payload = {
            "model": model,
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": 'Trả đúng JSON {"action":"get_time","args":{}} hoặc {"action":"final","answer":"..."}',
                },
                {"role": "user", "content": "mấy giờ rồi"},
            ],
        }
        try:
            resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
            text = resp.json().get("choices", [{}])[0].get("message", {}).get("content") or ""
            start, end = text.find("{"), text.rfind("}")
            json.loads(text[start : end + 1])
            ok += 1
        except Exception:
            pass
    return ok >= 4


async def probe_vietnamese(client, base_url, headers, model) -> bool:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Tóm tắt một câu: MMF là sản phẩm đầu tư ngắn hạn có thanh khoản cao."}],
    }
    try:
        resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=payload)
        text = resp.json().get("choices", [{}])[0].get("message", {}).get("content") or ""
        return bool(text.strip())
    except Exception:
        return False


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

