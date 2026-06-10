import tempfile
import unittest
from pathlib import Path

from daily_companion.agent import DailyCompanionAgent
from daily_companion.api import direct_api_authorized
from daily_companion.config import AgentConfig, parse_int_set
from daily_companion.knowledge import KnowledgeBase, build_index
from daily_companion.memory import extract_facts
from daily_companion.telegram import parse_callback, parse_message


class AgentTests(unittest.TestCase):
    def make_agent(self) -> DailyCompanionAgent:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        return DailyCompanionAgent(
            AgentConfig(
                agent_name="TestBot",
                agent_api_key="",
                memory_db_path=str(Path(tmpdir.name) / "memory.sqlite3"),
                llm_base_url="",
                llm_api_key="",
                llm_model="",
                llm_timeout_seconds=1,
                max_history_messages=8,
                knowledge_index_path=str(Path(tmpdir.name) / "knowledge.sqlite3"),
                knowledge_max_chunks=3,
                knowledge_max_context_chars=2000,
                telegram_bot_token="",
                telegram_webhook_secret="",
                telegram_allowed_user_ids=frozenset(),
                telegram_owner_user_ids=frozenset(),
            )
        )

    def test_extracts_vietnamese_preferences(self) -> None:
        facts = extract_facts("Gọi mình là Long, mình thích cà phê sữa đá")
        self.assertIn(("preferred_name", "long"), facts)
        self.assertIn(("likes", "cà phê sữa đá"), facts)

    def test_agent_responds_without_llm_and_remembers(self) -> None:
        agent = self.make_agent()
        result = agent.respond(
            "nhớ là mình thích nói chuyện buổi tối",
            user_id="u1",
            session_id="s1",
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["mode"], "fallback")
        memories = agent.list_memories("u1")
        self.assertTrue(any(item["key"] == "note" for item in memories))

    def test_empty_message_is_error(self) -> None:
        agent = self.make_agent()
        result = agent.respond(" ", user_id="u1", session_id="s1")
        self.assertEqual(result["status"], "error")

    def test_parse_telegram_message(self) -> None:
        message = parse_message(
            {
                "message": {
                    "text": "Xin chào",
                    "chat": {"id": 123},
                    "from": {"id": 456, "first_name": "Long"},
                }
            }
        )
        self.assertIsNotNone(message)
        self.assertEqual(message.chat_id, 123)
        self.assertEqual(message.user_id, 456)
        self.assertEqual(message.text, "Xin chào")

    def test_parse_allowed_user_ids(self) -> None:
        self.assertEqual(parse_int_set("123, 456;bad,,789"), frozenset({123, 456, 789}))

    def test_parse_telegram_callback(self) -> None:
        callback = parse_callback(
            {
                "callback_query": {
                    "id": "cb1",
                    "from": {"id": 456},
                    "message": {"message_id": 10, "chat": {"id": 456}},
                    "data": "access:accept:789:789",
                }
            }
        )
        self.assertIsNotNone(callback)
        self.assertEqual(callback.from_user_id, 456)
        self.assertEqual(callback.data, "access:accept:789:789")

    def test_telegram_access_approval(self) -> None:
        agent = self.make_agent()
        access = agent.memory.request_telegram_access(123, 456, "Long", "longdev")
        self.assertEqual(access.status, "pending")
        approved = agent.memory.approve_telegram_user(123)
        self.assertIsNotNone(approved)
        self.assertEqual(approved.status, "allowed")

    def test_direct_api_authorization(self) -> None:
        self.assertTrue(direct_api_authorized("", None, None))
        self.assertTrue(direct_api_authorized("secret", "secret", None))
        self.assertTrue(direct_api_authorized("secret", None, "Bearer secret"))
        self.assertFalse(direct_api_authorized("secret", "wrong", None))
        self.assertFalse(direct_api_authorized("secret", None, None))

    def test_build_and_search_knowledge_index(self) -> None:
        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        root = Path(tmpdir.name)
        source = root / "kb"
        source.mkdir()
        (source / "FD.md").write_text(
            "# Fixed Deposit\n\nFD supports term deposit journeys.", encoding="utf-8"
        )
        index = root / "knowledge.sqlite3"
        result = build_index(str(source), str(index))
        self.assertEqual(result["file_count"], 1)
        kb = KnowledgeBase(str(index))
        hits = kb.search("term deposit", limit=2)
        self.assertTrue(hits)
        self.assertIn("Fixed Deposit", hits[0].title)


if __name__ == "__main__":
    unittest.main()
