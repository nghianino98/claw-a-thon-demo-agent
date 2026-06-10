from __future__ import annotations

import random
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .bank import QUESTION_BANK, Question


class InterviewAgent:
    """Simple interview helper for AI Agent Q&A sessions."""

    def __init__(self, questions: Optional[List[Question]] = None) -> None:
        self._questions = questions or QUESTION_BANK
        self._by_id = {q.qid: q for q in self._questions}

    def get_questions(
        self,
        level: Optional[str] = None,
        limit: Optional[int] = None,
        shuffle: bool = False,
        seed: Optional[int] = None,
    ) -> List[Question]:
        items = [q for q in self._questions if not level or q.level == level]
        if shuffle:
            rng = random.Random(seed)
            rng.shuffle(items)
        if limit is not None:
            items = items[: max(0, limit)]
        return items

    def get_question_by_id(self, qid: str) -> Question:
        if qid not in self._by_id:
            raise KeyError(f"Unknown question id: {qid}")
        return self._by_id[qid]

    def score_answer(self, question: Question, answer: str) -> Dict[str, object]:
        normalized = answer.lower().strip()
        hits = [point for point in question.expected_points if point in normalized]
        ratio = len(hits) / max(1, len(question.expected_points))
        score = min(5, max(1, round(ratio * 5)))
        return {
            "question_id": question.qid,
            "score": score,
            "matched_points": hits,
            "missing_points": [p for p in question.expected_points if p not in hits],
        }

    def run_mock_interview(
        self,
        count: int = 5,
        level: Optional[str] = None,
        seed: Optional[int] = None,
        input_fn: Callable[[str], str] = input,
        print_fn: Callable[[str], None] = print,
    ) -> Dict[str, object]:
        selected = self.get_questions(level=level, limit=count, shuffle=True, seed=seed)
        if not selected:
            raise ValueError("No questions available for selected filters")

        print_fn("=== Mock Interview: AI Agent Engineer ===")
        report_items = []
        for idx, question in enumerate(selected, start=1):
            print_fn(f"\nQ{idx} [{question.level}/{question.category}] {question.prompt}")
            answer = input_fn("Your answer: ")
            result = self.score_answer(question, answer)
            report_items.append(result)
            print_fn(f"Score: {result['score']}/5")
            if result["missing_points"]:
                print_fn(f"Missing points: {', '.join(result['missing_points'])}")

        total = sum(item["score"] for item in report_items)
        average = total / len(report_items)
        final_report = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "questions": len(report_items),
            "total_score": total,
            "average_score": round(average, 2),
            "details": report_items,
        }
        print_fn(f"\nFinal average: {final_report['average_score']}/5")
        return final_report

    def export_markdown(self, output_path: str, questions: List[Question]) -> Path:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        lines = ["# AI Agent Interview Q&A", ""]
        for q in questions:
            lines.append(f"## {q.qid} - {q.prompt}")
            lines.append(f"- Level: `{q.level}`")
            lines.append(f"- Category: `{q.category}`")
            lines.append("- Expected points:")
            for point in q.expected_points:
                lines.append(f"  - {point}")
            lines.append("")

        path.write_text("\n".join(lines), encoding="utf-8")
        return path

