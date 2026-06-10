import tempfile
import unittest
from pathlib import Path

from interview_agent.agent import InterviewAgent


class InterviewAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.agent = InterviewAgent()

    def test_get_questions_by_level(self) -> None:
        questions = self.agent.get_questions(level="basic")
        self.assertTrue(questions)
        self.assertTrue(all(q.level == "basic" for q in questions))

    def test_shuffle_is_deterministic_with_seed(self) -> None:
        ids_1 = [q.qid for q in self.agent.get_questions(shuffle=True, seed=42)]
        ids_2 = [q.qid for q in self.agent.get_questions(shuffle=True, seed=42)]
        self.assertEqual(ids_1, ids_2)

    def test_score_answer_hits_expected_points(self) -> None:
        q = self.agent.get_question_by_id("B02")
        result = self.agent.score_answer(q, "Can call API function to increase accuracy for action")
        self.assertGreaterEqual(result["score"], 4)
        self.assertIn("api", result["matched_points"])

    def test_export_markdown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "qa.md"
            path = self.agent.export_markdown(str(output), self.agent.get_questions(limit=2))
            self.assertTrue(path.exists())
            self.assertIn("# AI Agent Interview Q&A", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

