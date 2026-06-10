from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class Question:
    qid: str
    level: str
    category: str
    prompt: str
    expected_points: List[str]


QUESTION_BANK: List[Question] = [
    Question(
        qid="B01",
        level="basic",
        category="fundamentals",
        prompt="Agent AI khac chatbot thong thuong nhu the nao?",
        expected_points=["tool", "memory", "multi-step", "goal"],
    ),
    Question(
        qid="B02",
        level="basic",
        category="fundamentals",
        prompt="Tool-calling la gi va tai sao quan trong?",
        expected_points=["api", "function", "accuracy", "action"],
    ),
    Question(
        qid="B03",
        level="basic",
        category="memory",
        prompt="Mo ta short-term memory va long-term memory trong agent.",
        expected_points=["context", "session", "profile", "store"],
    ),
    Question(
        qid="B04",
        level="basic",
        category="rag",
        prompt="RAG giup agent giam hallucination nhu the nao?",
        expected_points=["retrieve", "grounding", "source", "fresh"],
    ),
    Question(
        qid="I01",
        level="intermediate",
        category="architecture",
        prompt="Thiet ke pipeline agent production co cac khoi nao?",
        expected_points=["router", "planner", "executor", "guardrail", "logging"],
    ),
    Question(
        qid="I02",
        level="intermediate",
        category="architecture",
        prompt="Khi nao nen dung single-agent va khi nao dung multi-agent?",
        expected_points=["complexity", "latency", "specialization", "coordination"],
    ),
    Question(
        qid="I03",
        level="intermediate",
        category="reliability",
        prompt="Ban giam latency va cost cho agent bang nhung cach nao?",
        expected_points=["cache", "parallel", "tiering", "limit", "streaming"],
    ),
    Question(
        qid="I04",
        level="intermediate",
        category="security",
        prompt="Prompt injection la gi va cach phong chong?",
        expected_points=["sanitize", "trusted", "permission", "validation"],
    ),
    Question(
        qid="I05",
        level="intermediate",
        category="observability",
        prompt="Ban theo doi metric nao de danh gia chat luong agent?",
        expected_points=["success", "latency", "cost", "error", "escalation"],
    ),
    Question(
        qid="S01",
        level="senior",
        category="security",
        prompt="Thiet ke co che cap quyen tool an toan cho tac vu nhay cam.",
        expected_points=["least privilege", "scoped token", "allowlist", "approval"],
    ),
    Question(
        qid="S02",
        level="senior",
        category="system-design",
        prompt="Dam bao idempotency khi agent goi API thanh toan nhu the nao?",
        expected_points=["idempotency key", "retry", "dedupe", "audit"],
    ),
    Question(
        qid="S03",
        level="senior",
        category="operations",
        prompt="Neu agent tra loi sai chinh sach hoan tien, ban xu ly ra sao?",
        expected_points=["disable flow", "pin source", "backtest", "canary"],
    ),
    Question(
        qid="S04",
        level="senior",
        category="operations",
        prompt="Neu chi phi tang 3x sau khi them nhieu tool, ban dieu tra va toi uu the nao?",
        expected_points=["trace", "max steps", "router", "cache", "model"],
    ),
]

