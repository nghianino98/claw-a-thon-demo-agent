from __future__ import annotations

import argparse
import hmac
import json
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from .agent import DailyCompanionAgent
from .telegram import TelegramClient, parse_callback, parse_message


class AgentHTTPHandler(BaseHTTPRequestHandler):
    agent = DailyCompanionAgent()
    telegram = TelegramClient(agent.config.telegram_bot_token)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json({"status": "ok"})
            return

        if parsed.path == "/telegram/status":
            self._send_json(
                {
                    "status": "success",
                    "telegram_configured": self.telegram.configured,
                    "webhook_secret_configured": bool(
                        self.agent.config.telegram_webhook_secret
                    ),
                    "allowlist_enabled": bool(
                        self._telegram_access_control_enabled()
                    ),
                    "allowed_user_count": len(
                        self.agent.config.telegram_allowed_user_ids
                    ),
                    "owner_count": len(self.agent.config.telegram_owner_user_ids),
                    "direct_api_auth_configured": bool(self.agent.config.agent_api_key),
                    "knowledge": self.agent.knowledge.stats(),
                    "webhook_path": "/telegram/webhook/<secret>",
                }
            )
            return

        if parsed.path == "/memories":
            if not self._require_direct_api_authorization():
                return
            params = parse_qs(parsed.query)
            user_id = first(params.get("user_id")) or "default-user"
            self._send_json(
                {"status": "success", "memories": self.agent.list_memories(user_id)}
            )
            return

        if parsed.path == "/knowledge/status":
            if not self._require_direct_api_authorization():
                return
            self._send_json({"status": "success", "knowledge": self.agent.knowledge.stats()})
            return

        self._send_json({"status": "error", "error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/invocations":
            if not self._require_direct_api_authorization():
                return
            payload = self._read_json()
            message = str(payload.get("message", "")).strip()
            user_id = (
                self.headers.get("X-GreenNode-AgentBase-User-Id")
                or payload.get("user_id")
                or "default-user"
            )
            session_id = (
                self.headers.get("X-GreenNode-AgentBase-Session-Id")
                or payload.get("session_id")
                or "default-session"
            )
            result = self.agent.respond(message, str(user_id), str(session_id))
            status = HTTPStatus.OK if result["status"] == "success" else HTTPStatus.BAD_REQUEST
            self._send_json(result, status)
            return

        if parsed.path.startswith("/telegram/webhook"):
            self._handle_telegram_webhook(parsed.path)
            return

        if parsed.path == "/memories/clear":
            if not self._require_direct_api_authorization():
                return
            payload = self._read_json()
            user_id = str(payload.get("user_id") or "default-user")
            self.agent.clear_memories(user_id)
            self._send_json({"status": "success"})
            return

        self._send_json({"status": "error", "error": "Not found"}, HTTPStatus.NOT_FOUND)

    def _require_direct_api_authorization(self) -> bool:
        if direct_api_authorized(
            configured_key=self.agent.config.agent_api_key,
            x_api_key=self.headers.get("X-Agent-Api-Key"),
            authorization=self.headers.get("Authorization"),
        ):
            return True
        self._send_json(
            {"status": "error", "error": "Unauthorized."},
            HTTPStatus.UNAUTHORIZED,
        )
        return False

    def _handle_telegram_webhook(self, path: str) -> None:
        if not self.telegram.configured:
            self._send_json(
                {"status": "error", "error": "Telegram bot token is not configured."},
                HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        expected_secret = self.agent.config.telegram_webhook_secret
        if expected_secret and path != telegram_webhook_path(expected_secret):
            self._send_json(
                {"status": "error", "error": "Invalid Telegram webhook path."},
                HTTPStatus.NOT_FOUND,
            )
            return

        update = self._read_json()
        callback = parse_callback(update)
        if callback is not None:
            self._handle_telegram_callback(callback)
            self._send_json({"status": "accepted"})
            return

        telegram_message = parse_message(update)
        if telegram_message is None:
            self._send_json({"status": "ignored"})
            return

        if not self._telegram_user_allowed(telegram_message.user_id):
            worker = threading.Thread(
                target=self._request_telegram_access,
                args=(
                    telegram_message.chat_id,
                    telegram_message.user_id,
                    telegram_message.first_name,
                    telegram_message.username,
                ),
                daemon=True,
            )
            worker.start()
            self._send_json({"status": "accepted", "reason": "access_requested"})
            return

        worker = threading.Thread(
            target=self._reply_to_telegram,
            args=(telegram_message.chat_id, telegram_message.user_id, telegram_message.text),
            daemon=True,
        )
        worker.start()
        self._send_json({"status": "accepted"})

    def _telegram_access_control_enabled(self) -> bool:
        return bool(
            self.agent.config.telegram_allowed_user_ids
            or self.agent.config.telegram_owner_user_ids
        )

    def _telegram_user_allowed(self, user_id: int) -> bool:
        if not self._telegram_access_control_enabled():
            return True
        if user_id in self.agent.config.telegram_owner_user_ids:
            return True
        allowed_ids = self.agent.config.telegram_allowed_user_ids
        if user_id in allowed_ids:
            return True
        access = self.agent.memory.get_telegram_access(user_id)
        return bool(access and access.status == "allowed")

    def _request_telegram_access(
        self, chat_id: int, user_id: int, first_name: str, username: str
    ) -> None:
        access = self.agent.memory.request_telegram_access(
            user_id=user_id,
            chat_id=chat_id,
            display_name=first_name,
            username=username,
        )
        if not self.agent.config.telegram_owner_user_ids:
            self._send_no_owner_message(chat_id)
            return

        self._send_access_request_to_owners(access.user_id, access.chat_id, access.display_name, access.username)
        try:
            self.telegram.send_message(
                chat_id,
                "Mình đã gửi request access cho chủ bot rồi. Khi được duyệt, mình sẽ báo bạn vào đây nhé.",
            )
        except Exception:
            return

    def _send_no_owner_message(self, chat_id: int) -> None:
        try:
            self.telegram.send_message(
                chat_id,
                "Bot này đang giới hạn người dùng, nhưng chủ bot chưa cấu hình nơi nhận request access.",
            )
        except Exception:
            return

    def _send_access_request_to_owners(
        self, user_id: int, chat_id: int, display_name: str, username: str
    ) -> None:
        username_line = f"@{username}" if username else "(không có username)"
        text = (
            "Có user đang request access QueoSolutionBot.\n"
            f"Name: {display_name}\n"
            f"Username: {username_line}\n"
            f"User ID: {user_id}\n"
            f"Chat ID: {chat_id}"
        )
        reply_markup = {
            "inline_keyboard": [
                [
                    {
                        "text": "Accept",
                        "callback_data": f"access:accept:{user_id}:{chat_id}",
                    },
                    {
                        "text": "Reject",
                        "callback_data": f"access:reject:{user_id}:{chat_id}",
                    },
                ]
            ]
        }
        for owner_id in self.agent.config.telegram_owner_user_ids:
            try:
                self.telegram.send_message(owner_id, text, reply_markup=reply_markup)
            except Exception:
                continue

    def _handle_telegram_callback(self, callback) -> None:
        if callback.from_user_id not in self.agent.config.telegram_owner_user_ids:
            try:
                self.telegram.answer_callback_query(
                    callback.callback_id, "Bạn không có quyền duyệt request này."
                )
            except Exception:
                pass
            return

        parts = callback.data.split(":")
        if len(parts) != 4 or parts[0] != "access":
            try:
                self.telegram.answer_callback_query(callback.callback_id, "Action không hợp lệ.")
            except Exception:
                pass
            return

        action, user_id_text, chat_id_text = parts[1], parts[2], parts[3]
        try:
            user_id = int(user_id_text)
            chat_id = int(chat_id_text)
        except ValueError:
            try:
                self.telegram.answer_callback_query(callback.callback_id, "User/chat id không hợp lệ.")
            except Exception:
                pass
            return

        if action == "accept":
            access = self.agent.memory.approve_telegram_user(user_id)
            self._notify_access_approved(chat_id)
            self._finish_owner_callback(
                callback.callback_id,
                callback.message_chat_id,
                callback.message_id,
                f"Đã duyệt user {user_id}.",
            )
            if access and access.chat_id != chat_id:
                self._notify_access_approved(access.chat_id)
            return

        if action == "reject":
            self.agent.memory.reject_telegram_user(user_id)
            self._notify_access_rejected(chat_id)
            self._finish_owner_callback(
                callback.callback_id,
                callback.message_chat_id,
                callback.message_id,
                f"Đã từ chối user {user_id}.",
            )
            return

        try:
            self.telegram.answer_callback_query(callback.callback_id, "Action không hợp lệ.")
        except Exception:
            pass

    def _finish_owner_callback(
        self, callback_id: str, chat_id: int, message_id: int, text: str
    ) -> None:
        try:
            self.telegram.answer_callback_query(callback_id, text)
        except Exception:
            pass
        try:
            self.telegram.edit_message_text(chat_id, message_id, text)
        except Exception:
            pass

    def _notify_access_approved(self, chat_id: int) -> None:
        try:
            self.telegram.send_message(
                chat_id,
                "Bạn đã được duyệt access rồi. Bây giờ bạn có thể chat với QueoSolutionBot nhé.",
            )
        except Exception:
            return

    def _notify_access_rejected(self, chat_id: int) -> None:
        try:
            self.telegram.send_message(
                chat_id,
                "Request access của bạn chưa được duyệt. Bạn liên hệ chủ bot nếu cần thêm thông tin nhé.",
            )
        except Exception:
            return

    def _reply_to_telegram(self, chat_id: int, user_id: int, text: str) -> None:
        result = self.agent.respond(
            text,
            user_id=f"telegram-user-{user_id}",
            session_id=f"telegram-chat-{chat_id}",
        )
        if result["status"] == "success":
            response = result["response"]
        else:
            response = "Mình chưa xử lý được tin nhắn này. Bạn thử nhắn lại giúp mình nhé."
        try:
            self.telegram.send_message(chat_id, response)
        except Exception:
            # Avoid logging bot tokens from Telegram error contexts.
            return

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _send_json(
        self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def first(values: list[str] | None) -> str | None:
    if not values:
        return None
    return values[0]


def direct_api_authorized(
    configured_key: str, x_api_key: str | None, authorization: str | None
) -> bool:
    if not configured_key:
        return True

    candidates = []
    if x_api_key:
        candidates.append(x_api_key.strip())
    if authorization and authorization.lower().startswith("bearer "):
        candidates.append(authorization[7:].strip())

    return any(hmac.compare_digest(configured_key, candidate) for candidate in candidates)


def telegram_webhook_path(secret: str) -> str:
    if not secret:
        return "/telegram/webhook"
    return f"/telegram/webhook/{secret}"


def run_server(host: str = "0.0.0.0", port: int = 8080) -> None:
    server = ThreadingHTTPServer((host, port), AgentHTTPHandler)
    print(f"Daily companion agent listening on http://{host}:{port}")
    print("Health: GET /health")
    print("Chat:   POST /invocations")
    print("Telegram: POST /telegram/webhook/<secret>")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the daily companion agent API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8080, type=int)
    args = parser.parse_args()
    run_server(args.host, args.port)


if __name__ == "__main__":
    main()
