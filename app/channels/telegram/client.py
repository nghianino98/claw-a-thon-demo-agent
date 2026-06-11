from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from app.channels.telegram.formatting import render_telegram_html


class TelegramClient:
    def __init__(self, token: str):
        self.token = token
        self.base_url = f"https://api.telegram.org/bot{token}" if token else ""

    @property
    def configured(self) -> bool:
        return bool(self.token)

    async def send_message(
        self,
        chat_id: int,
        text: str,
        reply_markup: dict[str, Any] | None = None,
        parse_mode: str | None = "HTML",
    ) -> None:
        if not self.configured:
            return
        for chunk in chunk_text(text):
            payload: dict[str, Any] = {
                "chat_id": chat_id,
                "text": render_telegram_html(chunk) if parse_mode == "HTML" else chunk,
            }
            if parse_mode:
                payload["parse_mode"] = parse_mode
            if reply_markup:
                payload["reply_markup"] = reply_markup
            await self._post("sendMessage", payload)

    async def send_document(self, chat_id: int, path: str, caption: str | None = None) -> None:
        if not self.configured:
            return
        file_path = Path(path)
        if not file_path.exists() or file_path.stat().st_size > 50 * 1024 * 1024:
            await self.send_message(chat_id, f"Artifact sẵn sàng nhưng không gửi được qua Telegram: {path}")
            return
        data = {"chat_id": str(chat_id)}
        if caption:
            data["caption"] = caption
        async with httpx.AsyncClient(timeout=60) as client:
            with file_path.open("rb") as handle:
                await client.post(f"{self.base_url}/sendDocument", data=data, files={"document": handle})

    async def send_chat_action(self, chat_id: int, action: str = "typing") -> None:
        if self.configured:
            await self._post("sendChatAction", {"chat_id": chat_id, "action": action})

    async def answer_callback_query(self, callback_query_id: str, text: str = "") -> None:
        if self.configured:
            await self._post("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})

    async def leave_chat(self, chat_id: int) -> None:
        if self.configured:
            await self._post("leaveChat", {"chat_id": chat_id})

    async def get_updates(self, offset: int | None = None, timeout: int = 30) -> list[dict[str, Any]]:
        if not self.configured:
            return []
        params: dict[str, Any] = {"timeout": timeout, "allowed_updates": ["message", "callback_query"]}
        if offset is not None:
            params["offset"] = offset
        async with httpx.AsyncClient(timeout=timeout + 10) as client:
            resp = await client.get(f"{self.base_url}/getUpdates", params=params)
            resp.raise_for_status()
            data = resp.json()
        return data.get("result") or []

    async def _post(self, method: str, payload: dict[str, Any]) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(f"{self.base_url}/{method}", json=payload)


def chunk_text(text: str, limit: int = 3900) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    current = ""
    for line in text.splitlines() or [text]:
        if len(current) + len(line) + 1 > limit:
            if current:
                chunks.append(current)
            current = line
        else:
            current += ("\n" if current else "") + line
    if current:
        chunks.append(current)
    return chunks
