from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TelegramMessage:
    chat_id: int
    user_id: int
    text: str
    first_name: str
    username: str


@dataclass(frozen=True)
class TelegramCallback:
    callback_id: str
    from_user_id: int
    message_chat_id: int
    message_id: int
    data: str


class TelegramClient:
    def __init__(self, bot_token: str) -> None:
        self.bot_token = bot_token

    @property
    def configured(self) -> bool:
        return bool(self.bot_token)

    def send_message(
        self, chat_id: int, text: str, reply_markup: dict[str, Any] | None = None
    ) -> None:
        if not self.configured:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        for chunk in chunks(text, 3900):
            payload: dict[str, Any] = {
                "chat_id": chat_id,
                "text": chunk,
                "disable_web_page_preview": True,
            }
            if reply_markup is not None:
                payload["reply_markup"] = reply_markup
            body = json.dumps(payload).encode("utf-8")
            request = urllib.request.Request(
                url,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    response.read()
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"Telegram API HTTP {exc.code}: {detail}") from exc
            except urllib.error.URLError as exc:
                raise RuntimeError("Telegram API connection failed") from exc

    def answer_callback_query(self, callback_id: str, text: str) -> None:
        if not self.configured:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        self._post_json(
            "answerCallbackQuery",
            {
                "callback_query_id": callback_id,
                "text": text,
                "show_alert": False,
            },
        )

    def edit_message_text(self, chat_id: int, message_id: int, text: str) -> None:
        if not self.configured:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        self._post_json(
            "editMessageText",
            {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text,
                "disable_web_page_preview": True,
            },
        )

    def _post_json(self, method: str, payload: dict[str, Any]) -> None:
        url = f"https://api.telegram.org/bot{self.bot_token}/{method}"
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Telegram API HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError("Telegram API connection failed") from exc


def parse_message(update: dict[str, Any]) -> TelegramMessage | None:
    message = update.get("message") or update.get("edited_message")
    if not isinstance(message, dict):
        return None

    text = message.get("text")
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    chat_id = chat.get("id")
    user_id = user.get("id")
    if not isinstance(text, str) or not text.strip():
        return None
    if not isinstance(chat_id, int) or not isinstance(user_id, int):
        return None

    return TelegramMessage(
        chat_id=chat_id,
        user_id=user_id,
        text=text.strip(),
        first_name=str(user.get("first_name") or ""),
        username=str(user.get("username") or ""),
    )


def parse_callback(update: dict[str, Any]) -> TelegramCallback | None:
    callback = update.get("callback_query")
    if not isinstance(callback, dict):
        return None

    callback_id = callback.get("id")
    user = callback.get("from") or {}
    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    data = callback.get("data")
    from_user_id = user.get("id")
    chat_id = chat.get("id")
    message_id = message.get("message_id")

    if not isinstance(callback_id, str) or not callback_id:
        return None
    if not isinstance(from_user_id, int):
        return None
    if not isinstance(chat_id, int) or not isinstance(message_id, int):
        return None
    if not isinstance(data, str) or not data:
        return None

    return TelegramCallback(
        callback_id=callback_id,
        from_user_id=from_user_id,
        message_chat_id=chat_id,
        message_id=message_id,
        data=data,
    )


def chunks(text: str, size: int) -> list[str]:
    if len(text) <= size:
        return [text]
    return [text[index : index + size] for index in range(0, len(text), size)]
