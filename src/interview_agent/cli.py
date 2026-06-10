from __future__ import annotations

import argparse
import json
from typing import Optional

from .agent import InterviewAgent


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="interview-agent", description="AI Agent Interview Q&A helper")
    sub = parser.add_subparsers(dest="command", required=True)

    list_cmd = sub.add_parser("list", help="List available questions")
    list_cmd.add_argument("--level", choices=["basic", "intermediate", "senior"], default=None)
    list_cmd.add_argument("--limit", type=int, default=None)
    list_cmd.add_argument("--shuffle", action="store_true")
    list_cmd.add_argument("--seed", type=int, default=None)

    export_cmd = sub.add_parser("export", help="Export Q&A to markdown")
    export_cmd.add_argument("--output", required=True)
    export_cmd.add_argument("--level", choices=["basic", "intermediate", "senior"], default=None)
    export_cmd.add_argument("--limit", type=int, default=None)

    score_cmd = sub.add_parser("score", help="Score one answer")
    score_cmd.add_argument("--question-id", required=True)
    score_cmd.add_argument("--answer", required=True)

    mock_cmd = sub.add_parser("mock", help="Run interactive mock interview")
    mock_cmd.add_argument("--level", choices=["basic", "intermediate", "senior"], default=None)
    mock_cmd.add_argument("--count", type=int, default=5)
    mock_cmd.add_argument("--seed", type=int, default=None)

    return parser


def _print_questions(agent: InterviewAgent, level: Optional[str], limit: Optional[int], shuffle: bool, seed: Optional[int]) -> int:
    items = agent.get_questions(level=level, limit=limit, shuffle=shuffle, seed=seed)
    if not items:
        print("No questions found.")
        return 1

    for q in items:
        print(f"[{q.qid}] ({q.level}/{q.category}) {q.prompt}")
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    agent = InterviewAgent()

    if args.command == "list":
        return _print_questions(agent, args.level, args.limit, args.shuffle, args.seed)

    if args.command == "export":
        questions = agent.get_questions(level=args.level, limit=args.limit)
        output = agent.export_markdown(args.output, questions)
        print(f"Exported {len(questions)} questions to {output}")
        return 0

    if args.command == "score":
        question = agent.get_question_by_id(args.question_id)
        result = agent.score_answer(question, args.answer)
        print(json.dumps(result, indent=2))
        return 0

    if args.command == "mock":
        report = agent.run_mock_interview(count=args.count, level=args.level, seed=args.seed)
        print(json.dumps(report, indent=2))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

