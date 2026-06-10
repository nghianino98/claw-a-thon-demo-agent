from __future__ import annotations

import argparse

from daily_companion.api import run_server
from daily_companion.cli import run_chat
from daily_companion.knowledge import build_index


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily companion agent")
    subparsers = parser.add_subparsers(dest="command")

    serve = subparsers.add_parser("serve", help="Run HTTP API")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", default=8080, type=int)

    chat = subparsers.add_parser("chat", help="Chat in the terminal")
    chat.add_argument("--user-id", default="local-user")
    chat.add_argument("--session-id", default="local-session")

    index = subparsers.add_parser("index-knowledge", help="Build a knowledge index")
    index.add_argument("--source", required=True)
    index.add_argument("--index", default=".knowledge_base.sqlite3")

    args = parser.parse_args()
    if args.command == "chat":
        run_chat(args.user_id, args.session_id)
    elif args.command == "index-knowledge":
        result = build_index(args.source, args.index)
        print(result)
    else:
        run_server(args.host if hasattr(args, "host") else "0.0.0.0", getattr(args, "port", 8080))


if __name__ == "__main__":
    main()
