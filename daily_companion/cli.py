from __future__ import annotations

import argparse
import uuid

from .agent import DailyCompanionAgent


def run_chat(user_id: str, session_id: str) -> None:
    agent = DailyCompanionAgent()
    print(f"{agent.config.agent_name}: Mình đây. Gõ /exit để nghỉ, /memories để xem memory.")

    while True:
        try:
            message = input("Bạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not message:
            continue
        if message in {"/exit", "/quit"}:
            break
        if message == "/memories":
            memories = agent.list_memories(user_id)
            if not memories:
                print(f"{agent.config.agent_name}: Mình chưa lưu memory nào.")
            else:
                for item in memories:
                    print(f"- {item['key']}: {item['value']}")
            continue
        if message == "/reset":
            agent.clear_memories(user_id)
            print(f"{agent.config.agent_name}: Mình đã xóa memory của user này.")
            continue

        result = agent.respond(message, user_id=user_id, session_id=session_id)
        print(f"{agent.config.agent_name}: {result['response']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat with the daily companion agent")
    parser.add_argument("--user-id", default="local-user")
    parser.add_argument("--session-id", default=f"cli-{uuid.uuid4().hex[:8]}")
    args = parser.parse_args()
    run_chat(args.user_id, args.session_id)


if __name__ == "__main__":
    main()
