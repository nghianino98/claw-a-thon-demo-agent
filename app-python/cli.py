from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from app.channels.base import IncomingMessage
from app.main import build_services
from app.settings import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("migrate")

    index = sub.add_parser("index-kb")
    index.add_argument("--source", required=True)
    index.add_argument("--activate", action="store_true", default=False)

    sub.add_parser("status")
    sub.add_parser("chat")

    args = parser.parse_args()
    settings = get_settings()
    services = build_services(settings)

    if args.command == "migrate":
        print(f"DB ready: {settings.db_path}")
    elif args.command == "index-kb":
        version_id = services.kb.build_from_directory(Path(args.source), uploaded_by="cli", activate=args.activate)
        print(f"KB version {version_id} indexed. activate={args.activate}")
    elif args.command == "status":
        print(services.kb.status())
        print(f"skills={len(services.skills.list_enabled())} workflows={len(services.workflow_registry.list_enabled())}")
    elif args.command == "chat":
        asyncio.run(chat_loop(services))


async def chat_loop(services) -> None:
    print("Quéo CLI. Gõ /exit để thoát.")
    while True:
        text = input("Bạn> ").strip()
        if text in {"/exit", "/quit"}:
            break
        if not text:
            continue
        reply = await services.router.handle(
            IncomingMessage(user_id="cli-user", session_id="cli-session", text=text, channel="cli", actor="cli-user")
        )
        print(f"Quéo> {reply.text}")
        if reply.citations:
            print("Nguồn: " + "; ".join(reply.citations))


if __name__ == "__main__":
    main()

