from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .agent import InterviewAgent


app = FastAPI(title="Interview Agent API", version="0.1.0")
agent = InterviewAgent()


class ScoreRequest(BaseModel):
    question_id: str
    answer: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/questions")
def list_questions(level: str | None = None, limit: int | None = None) -> dict:
    items = agent.get_questions(level=level, limit=limit)
    return {
        "count": len(items),
        "items": [
            {
                "question_id": q.qid,
                "level": q.level,
                "category": q.category,
                "prompt": q.prompt,
            }
            for q in items
        ],
    }


@app.post("/score")
def score_answer(payload: ScoreRequest) -> dict:
    try:
        question = agent.get_question_by_id(payload.question_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return agent.score_answer(question, payload.answer)

