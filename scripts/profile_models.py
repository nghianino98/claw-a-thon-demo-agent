#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import httpx

# Add parent directory to sys.path so we can import from app
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from app.db import Database
from app.settings import get_settings
from app.utils import utc_now


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("LLM_BASE_URL", "").rstrip("/"))
    parser.add_argument("--api-key", default=os.environ.get("LLM_API_KEY", ""))
    parser.add_argument("--models", nargs="+", default=[])
    args = parser.parse_args()

    settings = get_settings()
    base_url = args.base_url or settings.llm_base_url
    api_key = args.api_key or settings.llm_api_key

    if not base_url:
        print("Missing LLM_BASE_URL", file=sys.stderr)
        return 2

    # If no models specified, use LLM_MODEL and LLM_MODEL_LITE from settings, or fallback list
    models = args.models
    if not models:
        models = [settings.llm_model]
        if settings.llm_model_lite and settings.llm_model_lite != settings.llm_model:
            models.append(settings.llm_model_lite)
        # Add common benchmark models if we want a default list
        for m in ["Gemma-4-31B-IT", "Qwen-3.7-Plus", "MiniMax-M2.5", "GPT-5", "Qwen-3.5-27B"]:
            if m not in models and m:
                models.append(m)
    
    # Filter out empty strings
    models = [m for m in models if m]

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    db = Database(settings.db_path)
    # Ensure migrations have run (including the new 0003 migration)
    from app.db.connection import run_migrations
    run_migrations(db)

    async with httpx.AsyncClient(timeout=60) as client:
        for model in models:
            print(f"Profiling model: {model} ...")
            try:
                # 1. Native Tool Calling
                native = await probe_native(client, base_url, headers, model)
                
                # 2. JSON mode (5 iterations, needs >= 4 passes)
                json_mode = await probe_json(client, base_url, headers, model)
                
                # 3. Vietnamese quality
                vn_score = await probe_vietnamese(client, base_url, headers, model)
                
                # 4. Long context
                long_ctx_score = await probe_long_ctx(client, base_url, headers, model)
                
                # 5. Code reasoning
                code_score = await probe_code(client, base_url, headers, model)
                
                # 6. Latency (p50 of 5 short calls)
                latency = await probe_latency(client, base_url, headers, model)
                
                # Save to database
                now_str = utc_now()
                with db.connect() as conn:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO model_profiles(
                            model, tool_native, tool_json, vn_score, long_ctx_score, code_score, latency_p50_ms, ctx_window, probed_at, notes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            model,
                            1 if native else 0,
                            1 if json_mode else 0,
                            vn_score,
                            long_ctx_score,
                            code_score,
                            latency,
                            128000 if "qwen" in model.lower() or "gpt" in model.lower() or "gemma" in model.lower() else 32000,
                            now_str,
                            f"Profiled via script. Tool native: {native}, JSON: {json_mode}"
                        )
                    )
                    conn.commit()
                
                print(f"  Result: native={native}, json={json_mode}, vn={vn_score}, long={long_ctx_score}, code={code_score}, latency={latency}ms")
            except Exception as e:
                print(f"  Failed to profile {model}: {e}", file=sys.stderr)

    print("Model profiling completed successfully.")
    return 0


async def probe_native(client: httpx.AsyncClient, base_url: str, headers: dict[str, str], model: str) -> bool:
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
        resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if resp.status_code != 200:
            return False
        data = resp.json()
        calls = data.get("choices", [{}])[0].get("message", {}).get("tool_calls") or []
        return bool(calls and calls[0].get("function", {}).get("name") == "get_time")
    except Exception:
        return False


async def probe_json(client: httpx.AsyncClient, base_url: str, headers: dict[str, str], model: str) -> bool:
    ok = 0
    for _ in range(5):
        payload = {
            "model": model,
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": 'You must reply ONLY with a JSON object in this format: {"action":"get_time","args":{}}',
                },
                {"role": "user", "content": "mấy giờ rồi"},
            ],
        }
        try:
            resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
            if resp.status_code != 200:
                continue
            text = resp.json().get("choices", [{}])[0].get("message", {}).get("content") or ""
            start, end = text.find("{"), text.rfind("}")
            if start != -1 and end != -1:
                obj = json.loads(text[start : end + 1])
                if obj.get("action") == "get_time":
                    ok += 1
        except Exception:
            pass
    return ok >= 4


async def probe_vietnamese(client: httpx.AsyncClient, base_url: str, headers: dict[str, str], model: str) -> float:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Tóm tắt đoạn văn sau bằng đúng 1 câu tiếng Việt ngắn gọn: MMF (Money Market Fund) là Quỹ thị trường tiền tệ đầu tư vào các công cụ tài chính ngắn hạn như tiền gửi ngân hàng, chứng chỉ tiền gửi có tính an toàn cao và thanh khoản hàng ngày."
            }
        ],
    }
    try:
        resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if resp.status_code != 200:
            return 0.0
        text = resp.json().get("choices", [{}])[0].get("message", {}).get("content") or ""
        # Basic check to verify it contains valid Vietnamese characters and summarizes
        if "quỹ" in text.lower() or "tiền" in text.lower() or "thanh khoản" in text.lower():
            return 9.0
        return 5.0 if text.strip() else 0.0
    except Exception:
        return 0.0


async def probe_long_ctx(client: httpx.AsyncClient, base_url: str, headers: dict[str, str], model: str) -> float:
    # Build a 20k characters prompt
    filler = "Đây là thông tin bổ trợ dài cho ngữ cảnh của mô hình ngôn ngữ. " * 300
    haystack = filler + " Mã bảo mật tối mật của quỹ Wealth là WEALTH-999." + filler
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Hãy đọc kỹ ngữ cảnh sau và trả lời câu hỏi chính xác."
            },
            {
                "role": "user",
                "content": f"Tài liệu tham khảo:\n{haystack}\n\nHỏi: Mã bảo mật tối mật của quỹ Wealth là gì? Chỉ trả lời đúng mã đó."
            }
        ],
    }
    try:
        resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if resp.status_code != 200:
            return 0.0
        text = resp.json().get("choices", [{}])[0].get("message", {}).get("content") or ""
        if "WEALTH-999" in text:
            return 10.0
        return 0.0
    except Exception:
        return 0.0


async def probe_code(client: httpx.AsyncClient, base_url: str, headers: dict[str, str], model: str) -> float:
    code_snippet = """
    func ProcessRedemption(userRole string, amount int) (string, error) {
        if userRole != "CFO" && amount > 500000000 {
            return "ERR_LIMIT_EXCEEDED", errors.New("limit exceeded for non-CFO users")
        }
        return "SUCCESS", nil
    }
    """
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": f"Đoạn mã nguồn:\n{code_snippet}\n\nHỏi: Nếu userRole là 'Developer' và amount là 600,000,000, hàm ProcessRedemption trả về chuỗi mã lỗi (string) là gì? Chỉ trả về chuỗi đó."
            }
        ],
    }
    try:
        resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if resp.status_code != 200:
            return 0.0
        text = resp.json().get("choices", [{}])[0].get("message", {}).get("content") or ""
        if "ERR_LIMIT_EXCEEDED" in text:
            return 10.0
        return 0.0
    except Exception:
        return 0.0


async def probe_latency(client: httpx.AsyncClient, base_url: str, headers: dict[str, str], model: str) -> int:
    latencies = []
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5,
    }
    for _ in range(5):
        t0 = time.perf_counter()
        try:
            resp = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
            if resp.status_code == 200:
                t1 = time.perf_counter()
                latencies.append(int((t1 - t0) * 1000))
        except Exception:
            pass
        await asyncio.sleep(0.5)
    
    if not latencies:
        return 0
    latencies.sort()
    # return median (p50)
    return latencies[len(latencies) // 2]


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
