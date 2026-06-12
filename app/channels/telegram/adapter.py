import asyncio
import contextlib
import difflib
import re
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
from app.utils import utc_now


from app.services.rate_limit import RateLimiter


TELEGRAM_COMMAND_RE = re.compile(r"^[a-z0-9_]{1,32}$")


def telegram_command_alias(value: str | None) -> str:
    raw = (value or "").strip().lower()
    raw = raw.split("@", 1)[0].lstrip("/")
    raw = raw.replace("-", "_")
    raw = re.sub(r"[^a-z0-9_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    return raw[:32]


class TelegramReplyHandle:
    def __init__(self, client: TelegramClient, chat_id: int, db: Any = None):
        self.client = client
        self.chat_id = chat_id
        self.db = db
        self.run_id: int | None = None
        self.progress_message_id: int | None = None
        self.progress_state: dict[str, Any] = {
            "step": 0,
            "max_steps": 0,
            "sources": 0,
            "phase": "đang chuẩn bị",
        }
        self.progress_finished = False

    async def send_text(self, text: str) -> int | None:
        msg_id = await self.client.send_message(self.chat_id, text)
        self._record_anchor(msg_id, "run_progress")
        return msg_id

    async def send_document(self, path: str, caption: str | None = None) -> int | None:
        msg_id = await self.client.send_document(self.chat_id, path, caption)
        self._record_anchor(msg_id, "artifact")
        return msg_id

    def note_progress(
        self,
        *,
        step: int | None = None,
        max_steps: int | None = None,
        phase: str | None = None,
        tool_name: str | None = None,
        sources: int | None = None,
    ) -> None:
        if step is not None:
            self.progress_state["step"] = step
        if max_steps is not None:
            self.progress_state["max_steps"] = max_steps
        if sources is not None:
            self.progress_state["sources"] = sources
        if phase:
            self.progress_state["phase"] = phase
        elif tool_name:
            if tool_name == "kb_read":
                self.progress_state["phase"] = "đang đọc nguồn liên quan"
            elif tool_name in {"kb_search", "kb_grep"}:
                self.progress_state["phase"] = "đang tìm nguồn trong KB"
            elif tool_name == "kb_list":
                self.progress_state["phase"] = "đang dò cấu trúc KB"
            else:
                self.progress_state["phase"] = "đang xử lý tool"

    async def send_or_edit_progress(self) -> None:
        text = self.progress_text()
        if self.progress_message_id:
            edited = await self.client.edit_message_text(self.chat_id, self.progress_message_id, text)
            if edited:
                return
        msg_id = await self.client.send_message(self.chat_id, text)
        if msg_id:
            self.progress_message_id = msg_id
            self._record_anchor(msg_id, "run_progress")

    async def finish_progress(self, cancelled: bool = False) -> None:
        self.progress_finished = True
        if not self.progress_message_id:
            return
        text = "Đã dừng tra cứu." if cancelled else "Xong."
        await self.client.edit_message_text(self.chat_id, self.progress_message_id, text)

    def progress_text(self) -> str:
        step = int(self.progress_state.get("step") or 0)
        max_steps = int(self.progress_state.get("max_steps") or 0)
        sources = int(self.progress_state.get("sources") or 0)
        phase = str(self.progress_state.get("phase") or "đang xử lý")
        parts = ["Đang tra cứu kỹ"]
        if step and max_steps:
            parts.append(f"bước {step}/{max_steps}")
        if sources:
            parts.append(f"đã chạm {sources} nguồn")
        parts.append(phase)
        return " · ".join(parts)

    def _record_anchor(self, msg_id: int | None, kind: str) -> None:
        if not self.db or not self.run_id or not msg_id:
            return
        try:
            with self.db.connect() as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO tg_anchors(tg_message_id, kind, ref_id, created_at)
                    VALUES (?,?,?,?)
                    """,
                    (msg_id, kind, self.run_id, utc_now()),
                )
                conn.commit()
        except Exception:
            pass


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
        rate_limit: RateLimiter,
        backup: Any | None = None,
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
        self.rate_limit = rate_limit
        self.backup = backup

    async def sync_commands(self) -> None:
        if not self.client.configured:
            return

        commands = [
            {"command": "start", "description": "Bắt đầu tương tác với Quéo"},
            {"command": "whoami", "description": "Kiểm tra thông tin tài khoản"},
            {"command": "new", "description": "Bắt đầu một chủ đề/segment mới"},
        ]

        try:
            with self.kb.db.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT workflow_id, command_alias, name, description
                    FROM workflows
                    WHERE enabled=1 AND show_in_menu=1
                    ORDER BY updated_at DESC, workflow_id
                    """
                ).fetchall()
            for r in rows:
                cmd = telegram_command_alias(r["command_alias"] or r["workflow_id"])
                if TELEGRAM_COMMAND_RE.match(cmd):
                    desc = (r["name"] or r["description"] or "Run workflow")[:256]
                    commands.append({"command": cmd, "description": desc or "Run workflow"})
        except Exception:
            pass

        try:
            with self.kb.db.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT skill_id, command_alias, name, description
                    FROM skills
                    WHERE enabled=1 AND show_in_menu=1
                    ORDER BY updated_at DESC, skill_id
                    """
                ).fetchall()
            for r in rows:
                cmd = telegram_command_alias(r["command_alias"] or r["skill_id"])
                if TELEGRAM_COMMAND_RE.match(cmd):
                    desc = (r["name"] or r["description"] or "Load skill")[:256]
                    commands.append({"command": cmd, "description": desc or "Load skill"})
        except Exception:
            pass

        seen_cmds = set()
        unique_commands = []
        for cmd_dict in commands:
            if cmd_dict["command"] not in seen_cmds:
                seen_cmds.add(cmd_dict["command"])
                unique_commands.append(cmd_dict)
            if len(unique_commands) >= 100:
                break

        await self.client.set_my_commands(unique_commands)

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
            await self._dispatch_allowed(user, chat_id, text, owner=True, raw_message=message)
            return
        if status == "allowed":
            await self._dispatch_allowed(user, chat_id, text, owner=False, raw_message=message)
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

    async def _dispatch_allowed(
        self,
        user: dict[str, Any],
        chat_id: int,
        text: str,
        owner: bool,
        raw_message: dict[str, Any],
    ) -> None:
        user_id = int(user["id"])
        handle = TelegramReplyHandle(self.client, chat_id, db=self.kb.db)
        if not self.rate_limit.check(f"tg-{user_id}"):
            self.audit.record(f"tg-{user_id}", "rate_limit_exceeded", "telegram", {"chat_id": chat_id})
            await handle.send_text("Bạn đã vượt quá giới hạn tần suất yêu cầu. Vui lòng thử lại sau.")
            return

        # 1. Check idle timeout (6h) and auto-segment
        state = self.memory.get_session_state(f"tg-{user_id}", f"tg-chat-{chat_id}")
        last_updated = state.get("updated_at")
        if last_updated:
            from datetime import datetime, UTC
            try:
                dt = datetime.fromisoformat(last_updated.replace("Z", "+00:00"))
                diff = datetime.now(UTC) - dt
                if diff.total_seconds() > 6 * 3600:
                    state["segment_no"] = state.get("segment_no", 1) + 1
                    state["summary"] = ""
                    state["active_skill"] = None
                    state["pending_question"] = None
                    state["segment_started_message_id"] = 0
                    self.memory.save_session_state(f"tg-{user_id}", f"tg-chat-{chat_id}", state)
            except Exception:
                pass

        # 2. Command handling
        command, _, arg = text.partition(" ")
        command = command.split("@", 1)[0].lower()
        if command.startswith("/"):
            if command == "/new":
                state = self.memory.get_session_state(f"tg-{user_id}", f"tg-chat-{chat_id}")
                state["segment_no"] = state.get("segment_no", 1) + 1
                state["summary"] = ""
                state["active_skill"] = None
                state["pending_question"] = None
                state["segment_started_message_id"] = 0
                self.memory.save_session_state(f"tg-{user_id}", f"tg-chat-{chat_id}", state)
                await handle.send_text("🆕 Bắt đầu chủ đề mới.")
                self.memory.add_message(f"tg-{user_id}", f"tg-chat-{chat_id}", "user", text)
                return

            handled = await self._command(command, arg.strip(), user_id, chat_id, owner, handle)
            if handled:
                if handled != "no_record":
                    self.memory.add_message(f"tg-{user_id}", f"tg-chat-{chat_id}", "user", text)
                return
            if command != "/deep":
                await self._send_unknown_command(command, handle)
                self.memory.add_message(f"tg-{user_id}", f"tg-chat-{chat_id}", "user", text)
                return

        # 3. Handle quote/reply context (L4b)
        reply_to = raw_message.get("reply_to_message")
        quote = raw_message.get("quote")
        reply_to_msg_id = reply_to.get("message_id") if reply_to else None

        reply_context = ""
        if reply_to or quote:
            quoted_text = ""
            if quote and quote.get("text"):
                quoted_text = quote.get("text")
            elif reply_to and reply_to.get("text"):
                quoted_text = reply_to.get("text")

            if quoted_text:
                reply_context = f"[REPLY CONTEXT]\nContent: {quoted_text}\n"
                if reply_to_msg_id:
                    try:
                        with self.kb.db.connect() as conn:
                            anchor = conn.execute("SELECT kind, ref_id FROM tg_anchors WHERE tg_message_id=?", (reply_to_msg_id,)).fetchone()
                            msg_row = conn.execute("SELECT content FROM messages WHERE tg_message_id=?", (reply_to_msg_id,)).fetchone()
                        if anchor:
                            kind, ref_id = anchor["kind"], anchor["ref_id"]
                            if kind == "artifact":
                                with self.kb.db.connect() as conn:
                                    run_row = conn.execute("SELECT workflow_id, status FROM workflow_runs WHERE id=?", (ref_id,)).fetchone()
                                if run_row:
                                    reply_context += f"Ref Run: #{ref_id}\nWorkflow: {run_row['workflow_id']}\nStatus: {run_row['status']}\n"
                            elif kind == "run_progress":
                                reply_context += f"Ref Run ID: {ref_id}\n"
                        elif msg_row:
                            reply_context += f"Orig Content: {msg_row['content']}\n"
                    except Exception:
                        pass

        # 4. Save user message to database to get message ID
        tg_msg_id = raw_message.get("message_id")
        user_msg_db_id = self.memory.add_message(
            f"tg-{user_id}",
            f"tg-chat-{chat_id}",
            "user",
            text,
            tg_message_id=tg_msg_id,
            reply_to_tg_message_id=reply_to_msg_id,
        )

        # 5. If segment_started_message_id is 0, update it to this user message's database ID
        state = self.memory.get_session_state(f"tg-{user_id}", f"tg-chat-{chat_id}")
        if not state.get("segment_started_message_id") and user_msg_db_id:
            state["segment_started_message_id"] = user_msg_db_id
            self.memory.save_session_state(f"tg-{user_id}", f"tg-chat-{chat_id}", state)

        # 6. Dispatch to router
        await self.client.send_chat_action(chat_id, "typing")
        typing_task = asyncio.create_task(self._typing_loop(chat_id))
        progress_task = asyncio.create_task(self._progress_loop(handle))
        reply = None
        try:
            reply = await self.router.handle(
                IncomingMessage(
                    user_id=f"tg-{user_id}",
                    session_id=f"tg-chat-{chat_id}",
                    text=text,
                    channel="telegram",
                    actor=f"tg-{user_id}",
                    reply_context=reply_context,
                    tg_message_id=tg_msg_id,
                    reply_to_tg_message_id=reply_to_msg_id,
                    user_msg_db_id=user_msg_db_id,
                ),
                reply_handle=handle,
            )
        finally:
            typing_task.cancel()
            progress_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await typing_task
            with contextlib.suppress(asyncio.CancelledError):
                await progress_task
            await handle.finish_progress(cancelled=bool(reply and reply.mode == "cancelled"))

        # 7. Send reply and record it
        assistant_msg_id = await handle.send_text(reply.text)
        if assistant_msg_id and reply.text:
            self.memory.add_message(
                f"tg-{user_id}",
                f"tg-chat-{chat_id}",
                "assistant",
                reply.text,
                tg_message_id=assistant_msg_id,
            )

        for artifact in reply.artifacts:
            await handle.send_document(str(self.kb.settings.state_dir / artifact), "Artifact")

    async def _typing_loop(self, chat_id: int) -> None:
        while True:
            await asyncio.sleep(5)
            await self.client.send_chat_action(chat_id, "typing")

    async def _progress_loop(self, handle: TelegramReplyHandle) -> None:
        first = max(0, self.kb.settings.progress_first_seconds)
        update = max(1, self.kb.settings.progress_update_seconds)
        await asyncio.sleep(first)
        while not handle.progress_finished:
            await handle.send_or_edit_progress()
            await asyncio.sleep(update)

    async def _command(
        self,
        command: str,
        arg: str,
        user_id: int,
        chat_id: int,
        owner: bool,
        handle: TelegramReplyHandle,
    ) -> bool | str:
        if command == "/start":
            await handle.send_text("Quéo đã sẵn sàng. Dùng /help để xem lệnh.")
        elif command == "/help":
            await handle.send_text(
                "/skills, /workflows, /run <id> [tham số], /deep <câu hỏi>, /cancel [run_id], /new, /whoami, /forget\n"
                "Bạn cũng có thể dùng /<alias> từ menu lệnh hoặc reply vào câu trả lời cũ để hỏi tiếp đúng ngữ cảnh."
            )
        elif command == "/whoami":
            await handle.send_text(f"Telegram ID: {user_id}\nRole: {'owner' if owner else 'allowed'}\nStatus: {self.access.status(user_id)}")
        elif command == "/skills":
            skills = self.skills.list_enabled()
            await handle.send_text(
                "\n".join(f"- /{telegram_command_alias(s.command_alias or s.skill_id)}: {s.name} - {s.description}" for s in skills)
                or "Chưa có skill."
            )
        elif command == "/workflows":
            workflows = self.workflow_registry.list_enabled()
            await handle.send_text(
                "\n".join(f"- /{telegram_command_alias(w.command_alias or w.workflow_id)}: {w.description or w.name}" for w in workflows)
                or "Chưa có workflow."
            )
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
            if not arg:
                cancelled = self.router.cancel_session(f"tg-chat-{chat_id}", f"tg-{user_id}", "telegram")
                await handle.send_text("Đã hủy lượt xử lý hiện tại." if cancelled else "Không có lượt xử lý nào đang chạy để hủy.")
            elif not arg.isdigit():
                await handle.send_text("Cú pháp: /cancel hoặc /cancel <run_id>")
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
            handled = await self._dynamic_command(command, arg, user_id, handle)
            if handled:
                return True
            return False
        return True

    async def _dynamic_command(self, command: str, arg: str, user_id: int, handle: TelegramReplyHandle) -> bool | str:
        token = telegram_command_alias(command)
        if not token:
            return False
        target = self._resolve_dynamic_command(token)
        if not target:
            return False
        kind, entity_id = target
        if kind == "workflow":
            run_id = await self.workflows.start(entity_id, arg, "telegram", f"tg-{user_id}", handle)
            await handle.send_text(f"Đã xếp workflow `{entity_id}` vào run #{run_id}.")
            return True
        state = self.memory.get_session_state(f"tg-{user_id}", f"tg-chat-{handle.chat_id}")
        state["active_skill"] = entity_id
        state["active_skill_expires_at"] = None
        if arg:
            self.memory.save_session_state(f"tg-{user_id}", f"tg-chat-{handle.chat_id}", state)
            user_msg_db_id = self.memory.add_message(f"tg-{user_id}", f"tg-chat-{handle.chat_id}", "user", arg)
            reply = await self.router.handle(
                IncomingMessage(
                    user_id=f"tg-{user_id}",
                    session_id=f"tg-chat-{handle.chat_id}",
                    text=arg,
                    channel="telegram",
                    actor=f"tg-{user_id}",
                    user_msg_db_id=user_msg_db_id,
                ),
                reply_handle=handle,
            )
            assistant_msg_id = await handle.send_text(reply.text)
            if assistant_msg_id:
                self.memory.add_message(
                    f"tg-{user_id}",
                    f"tg-chat-{handle.chat_id}",
                    "assistant",
                    reply.text,
                    tg_message_id=assistant_msg_id,
                )
            return "no_record"
        record = self.skills.get(entity_id)
        question = f"Bạn muốn dùng skill `{entity_id}` vào việc gì?"
        state["pending_question"] = question
        self.memory.save_session_state(f"tg-{user_id}", f"tg-chat-{handle.chat_id}", state)
        desc = record.description if record else entity_id
        await handle.send_text(f"{desc}\n\n{question}")
        return True

    def _resolve_dynamic_command(self, token: str) -> tuple[str, str] | None:
        try:
            with self.kb.db.connect() as conn:
                rows = conn.execute(
                    "SELECT workflow_id, command_alias FROM workflows WHERE enabled=1 ORDER BY workflow_id"
                ).fetchall()
            for row in rows:
                candidates = {
                    telegram_command_alias(row["command_alias"]),
                    telegram_command_alias(row["workflow_id"]),
                }
                if token in candidates:
                    return ("workflow", row["workflow_id"])
        except Exception:
            pass
        try:
            with self.kb.db.connect() as conn:
                rows = conn.execute("SELECT skill_id, command_alias FROM skills WHERE enabled=1 ORDER BY skill_id").fetchall()
            for row in rows:
                candidates = {
                    telegram_command_alias(row["command_alias"]),
                    telegram_command_alias(row["skill_id"]),
                }
                if token in candidates:
                    return ("skill", row["skill_id"])
        except Exception:
            pass
        return None

    async def _send_unknown_command(self, command: str, handle: TelegramReplyHandle) -> None:
        token = telegram_command_alias(command)
        aliases = self._available_command_aliases()
        matches = difflib.get_close_matches(token, aliases, n=3, cutoff=0.5)
        if matches:
            suggestions = "\n".join(f"- /{alias}" for alias in matches)
            await handle.send_text(f"Mình chưa nhận ra lệnh đó. Có phải bạn muốn dùng:\n{suggestions}\n\nDùng /help để xem lệnh.")
        else:
            await handle.send_text("Mình chưa nhận ra lệnh đó. Dùng /help để xem lệnh.")

    def _available_command_aliases(self) -> list[str]:
        aliases = ["start", "help", "whoami", "skills", "workflows", "run", "cancel", "forget", "new", "deep"]
        try:
            with self.kb.db.connect() as conn:
                workflow_rows = conn.execute("SELECT workflow_id, command_alias FROM workflows WHERE enabled=1").fetchall()
                skill_rows = conn.execute("SELECT skill_id, command_alias FROM skills WHERE enabled=1").fetchall()
            aliases.extend(telegram_command_alias(row["command_alias"] or row["workflow_id"]) for row in workflow_rows)
            aliases.extend(telegram_command_alias(row["command_alias"] or row["skill_id"]) for row in skill_rows)
        except Exception:
            pass
        return [alias for alias in aliases if alias]

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
            self._bump_registry_version(f"tg-{owner_id}")
            self._schedule_backup_after_kb_change("telegram_kb_activate", f"kb:{arg}", f"tg-{owner_id}")
            asyncio.create_task(self.sync_commands())
            await handle.send_text(f"Đã activate KB version {arg}.")
        elif command == "/runs":
            runs = self.workflows.recent_runs(5)
            await handle.send_text("\n".join(f"- #{r['id']} {r['workflow_id']} {r['status']}" for r in runs) or "Chưa có run.")

    def _bump_registry_version(self, actor: str) -> None:
        try:
            with self.kb.db.connect() as conn:
                row = conn.execute("SELECT value FROM settings WHERE key='registry_version'").fetchone()
                try:
                    version = int(row["value"]) if row else 0
                except Exception:
                    version = 0
                conn.execute(
                    """
                    INSERT INTO settings(key, value, updated_at, updated_by)
                    VALUES ('registry_version', ?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
                    """,
                    (str(version + 1), utc_now(), actor),
                )
                conn.commit()
        except Exception:
            pass

    def _schedule_backup_after_kb_change(self, reason: str, target: str, actor: str) -> None:
        if not self.backup or not getattr(self.backup, "enabled", False):
            return

        async def run_backup() -> None:
            try:
                await asyncio.to_thread(self.backup.backup)
                self.audit.record(actor, "backup_success", target, {"reason": reason})
            except Exception as exc:
                self.audit.record(actor, "backup_failed", target, {"reason": reason, "error": str(exc)})

        asyncio.create_task(run_backup())

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
