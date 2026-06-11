from __future__ import annotations

import asyncio
from typing import Any

from app.channels.base import IncomingMessage
from app.channels.telegram.client import TelegramClient
from app.core.router import MessageRouter
from app.core.workflows import WorkflowEngine
from app.services.access import AccessService
from app.services.audit import AuditService
from app.services.kb import KBService
from app.services.memory import MemoryService
from app.services.registry import SkillRegistry, WorkflowRegistry


class TelegramReplyHandle:
    def __init__(self, client: TelegramClient, chat_id: int):
        self.client = client
        self.chat_id = chat_id

    async def send_text(self, text: str) -> None:
        await self.client.send_message(self.chat_id, text)

    async def send_document(self, path: str, caption: str | None = None) -> None:
        await self.client.send_document(self.chat_id, path, caption)


class TelegramAdapter:
    def __init__(
        self,
        client: TelegramClient,
        access: AccessService,
        router: MessageRouter,
        workflows: WorkflowEngine,
        kb: KBService,
        memory: MemoryService,
        skills: SkillRegistry,
        workflow_registry: WorkflowRegistry,
        audit: AuditService,
    ):
        self.client = client
        self.access = access
        self.router = router
        self.workflows = workflows
        self.kb = kb
        self.memory = memory
        self.skills = skills
        self.workflow_registry = workflow_registry
        self.audit = audit

    async def handle_update(self, update: dict[str, Any]) -> None:
        if "callback_query" in update:
            await self._handle_callback(update["callback_query"])
            return
        message = update.get("message")
        if not message or "text" not in message:
            return
        asyncio.create_task(self._handle_message(message))

    async def _handle_message(self, message: dict[str, Any]) -> None:
        chat = message.get("chat") or {}
        user = message.get("from") or {}
        chat_id = int(chat.get("id"))
        user_id = int(user.get("id"))
        text = str(message.get("text") or "").strip()
        if chat.get("type") != "private":
            self.audit.record(f"tg-{user_id}", "denied_access", "group", {"chat_id": chat_id})
            await self.client.leave_chat(chat_id)
            return

        command = text.split(maxsplit=1)[0].split("@", 1)[0].lower() if text.startswith("/") else ""
        status = self.access.status(user_id)
        if self.access.is_owner(user_id):
            await self._dispatch_allowed(user, chat_id, text, owner=True)
            return
        if status == "allowed":
            await self._dispatch_allowed(user, chat_id, text, owner=False)
            return
        if command in {"/start", "/whoami"}:
            if not status:
                status = self.access.request_access(user, chat_id)
                await self._notify_owners(user, chat_id)
            await self.client.send_message(chat_id, f"Trạng thái truy cập của bạn: {status}. Telegram ID: {user_id}")
            return
        if status == "pending":
            await self.client.send_message(chat_id, "Yêu cầu truy cập của bạn đang chờ owner duyệt.")
            return
        if status in {"rejected", "revoked"}:
            self.audit.record(f"tg-{user_id}", "denied_access", "telegram", {"status": status})
            return
        self.access.request_access(user, chat_id)
        await self._notify_owners(user, chat_id)
        await self.client.send_message(chat_id, "Mình đã gửi yêu cầu truy cập tới owner. Khi được duyệt bạn có thể chat với Quéo.")

    async def _dispatch_allowed(self, user: dict[str, Any], chat_id: int, text: str, owner: bool) -> None:
        user_id = int(user["id"])
        handle = TelegramReplyHandle(self.client, chat_id)
        command, _, arg = text.partition(" ")
        command = command.split("@", 1)[0].lower()
        if command.startswith("/"):
            handled = await self._command(command, arg.strip(), user_id, chat_id, owner, handle)
            if handled:
                return
        await self.client.send_chat_action(chat_id, "typing")
        reply = await self.router.handle(
            IncomingMessage(
                user_id=f"tg-{user_id}",
                session_id=f"tg-chat-{chat_id}",
                text=text,
                channel="telegram",
                actor=f"tg-{user_id}",
            ),
            reply_handle=handle,
        )
        await handle.send_text(reply.text)
        for artifact in reply.artifacts:
            await handle.send_document(str(self.kb.settings.state_dir / artifact), "Artifact")

    async def _command(
        self,
        command: str,
        arg: str,
        user_id: int,
        chat_id: int,
        owner: bool,
        handle: TelegramReplyHandle,
    ) -> bool:
        if command == "/start":
            await handle.send_text("Quéo đã sẵn sàng. Dùng /help để xem lệnh.")
        elif command == "/help":
            await handle.send_text("/skills, /workflows, /run <id> [tham số], /cancel <run_id>, /whoami, /forget")
        elif command == "/whoami":
            await handle.send_text(f"Telegram ID: {user_id}\nRole: {'owner' if owner else 'allowed'}\nStatus: {self.access.status(user_id)}")
        elif command == "/skills":
            skills = self.skills.list_enabled()
            await handle.send_text("\n".join(f"- {s.skill_id}: {s.description}" for s in skills) or "Chưa có skill.")
        elif command == "/workflows":
            workflows = self.workflow_registry.list_enabled()
            await handle.send_text("\n".join(f"- {w.workflow_id}: {w.description or w.name}" for w in workflows) or "Chưa có workflow.")
        elif command == "/forget":
            self.memory.clear(f"tg-{user_id}")
            await handle.send_text("Đã xóa memory của bạn.")
        elif command == "/run":
            workflow_id, _, params = arg.partition(" ")
            if not workflow_id:
                await handle.send_text("Cú pháp: /run <workflow_id> [tham số]")
            else:
                run_id = await self.workflows.start(workflow_id, params, "telegram", f"tg-{user_id}", handle)
                await handle.send_text(f"Đã xếp workflow `{workflow_id}` vào run #{run_id}.")
        elif command == "/cancel":
            if not arg.isdigit():
                await handle.send_text("Cú pháp: /cancel <run_id>")
            elif await self.workflows.cancel(int(arg), f"tg-{user_id}"):
                await handle.send_text(f"Đã gửi yêu cầu hủy run #{arg}.")
            else:
                await handle.send_text("Không tìm thấy run đang chạy/có thể hủy.")
        elif command in {"/approve", "/revoke", "/users", "/status", "/kb_activate", "/runs"}:
            if not owner:
                await handle.send_text("Lệnh này chỉ dành cho owner.")
            else:
                await self._owner_command(command, arg, user_id, handle)
        else:
            return False
        return True

    async def _owner_command(self, command: str, arg: str, owner_id: int, handle: TelegramReplyHandle) -> None:
        if command == "/approve":
            if not arg.isdigit():
                await handle.send_text("Cú pháp: /approve <tg_id>")
                return
            self.access.set_status(int(arg), "allowed", f"tg-{owner_id}")
            await handle.send_text(f"Đã approve {arg}.")
        elif command == "/revoke":
            if not arg.isdigit():
                await handle.send_text("Cú pháp: /revoke <tg_id>")
                return
            self.access.set_status(int(arg), "revoked", f"tg-{owner_id}")
            await handle.send_text(f"Đã revoke {arg}.")
        elif command == "/users":
            users = self.access.users(limit=50)
            await handle.send_text("\n".join(f"- {u['user_id']}: {u['status']} @{u.get('username') or ''}" for u in users) or "Chưa có user.")
        elif command == "/status":
            await handle.send_text(f"KB: {self.kb.status()}\nRuns: {len(self.workflows.tasks)} running")
        elif command == "/kb_activate":
            if not arg.isdigit():
                await handle.send_text("Cú pháp: /kb_activate <version_id>")
                return
            self.kb.activate_version(int(arg))
            await handle.send_text(f"Đã activate KB version {arg}.")
        elif command == "/runs":
            runs = self.workflows.recent_runs(5)
            await handle.send_text("\n".join(f"- #{r['id']} {r['workflow_id']} {r['status']}" for r in runs) or "Chưa có run.")

    async def _handle_callback(self, callback: dict[str, Any]) -> None:
        data = str(callback.get("data") or "")
        from_user = callback.get("from") or {}
        owner_id = int(from_user.get("id"))
        callback_id = str(callback.get("id"))
        if not self.access.is_owner(owner_id):
            await self.client.answer_callback_query(callback_id, "Bạn không có quyền duyệt.")
            return
        if not data.startswith("access:"):
            return
        try:
            _, action, uid_s, chat_s = data.split(":", 3)
            target_uid = int(uid_s)
            target_chat = int(chat_s)
        except ValueError:
            await self.client.answer_callback_query(callback_id, "Callback không hợp lệ.")
            return
        status = "allowed" if action == "accept" else "rejected"
        self.access.set_status(target_uid, status, f"tg-{owner_id}")
        await self.client.answer_callback_query(callback_id, f"Đã {status}.")
        await self.client.send_message(target_chat, "Bạn đã được duyệt để chat với Quéo." if status == "allowed" else "Yêu cầu truy cập của bạn đã bị từ chối.")

    async def _notify_owners(self, user: dict[str, Any], chat_id: int) -> None:
        uid = int(user["id"])
        name = " ".join(part for part in [user.get("first_name"), user.get("last_name")] if part).strip()
        username = user.get("username") or ""
        markup = {
            "inline_keyboard": [
                [
                    {"text": "Approve", "callback_data": f"access:accept:{uid}:{chat_id}"},
                    {"text": "Reject", "callback_data": f"access:reject:{uid}:{chat_id}"},
                ]
            ]
        }
        for owner_id in self.access.settings.telegram_owner_user_ids:
            await self.client.send_message(owner_id, f"Yêu cầu truy cập Quéo:\nID: {uid}\nTên: {name}\nUsername: @{username}", reply_markup=markup)
