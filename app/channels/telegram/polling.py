from __future__ import annotations

import asyncio

from app.channels.telegram.adapter import TelegramAdapter
from app.channels.telegram.client import TelegramClient
from app.utils import log_event


async def polling_loop(client: TelegramClient, adapter: TelegramAdapter) -> None:
    offset: int | None = None
    while True:
        try:
            updates = await client.get_updates(offset=offset, timeout=30)
            for update in updates:
                offset = int(update["update_id"]) + 1
                await adapter.handle_update(update)
        except Exception as exc:
            log_event("warning", "telegram_polling_error", error=str(exc))
            await asyncio.sleep(5)

