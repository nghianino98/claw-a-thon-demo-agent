#!/usr/bin/env python3
import asyncio
import os
import sys
import yaml
from pathlib import Path

from app.settings import get_settings
from app.main import build_services
from app.core.types import AgentContext
from app.utils import utc_now, log_event

async def run_evaluation():
    settings = get_settings()
    if not settings.llm_base_url or not settings.llm_model:
        print("❌ Error: LLM must be configured in .env to run evaluation.")
        sys.exit(1)
        
    services = build_services(settings)
    loop = services.agent_loop
    
    questions_path = Path("tests/eval/questions.yaml")
    if not questions_path.exists():
        print(f"❌ Error: {questions_path} does not exist.")
        sys.exit(1)
        
    with questions_path.open("r", encoding="utf-8") as f:
        questions = yaml.safe_load(f)
        
    # Clear previous evaluation data from DB
    import sqlite3
    try:
        conn = sqlite3.connect(settings.db_path)
        conn.execute("DELETE FROM messages WHERE user_id = 'eval-user'")
        conn.execute("DELETE FROM session_state WHERE user_id = 'eval-user'")
        conn.execute("DELETE FROM facts WHERE user_id = 'eval-user'")
        conn.commit()
        conn.close()
        print("🧹 Cleared previous evaluation session data from database.")
    except Exception as e:
        print(f"⚠️ Warning: could not clear evaluation DB data: {e}")
        
    print(f"🚀 Running evaluation on {len(questions)} questions...")
    
    results = []
    correct_count = 0
    citation_correct_count = 0
    total_count = len(questions)
    
    for idx, q in enumerate(questions, start=1):
        qid = q.get("id")
        qtype = q.get("type")
        qtext = q.get("question")
        expected_srcs = q.get("expected_source") or []
        must_contain = q.get("must_contain") or []
        
        print(f"\n[{idx}/{total_count}] Run {qid} ({qtype}): {qtext}")
        
        ctx = AgentContext(
            user_id="eval-user",
            session_id=f"eval-session-{qid}",
            message=qtext,
            mode="qa"
        )
        
        try:
            reply = await loop.run(ctx)
            reply_text = reply.text
            citations = reply.citations or []
            
            missing_terms = [term for term in must_contain if term.lower() not in reply_text.lower()]
            text_correct = len(missing_terms) == 0
            
            citation_correct = False
            if not expected_srcs:
                citation_correct = True
            else:
                for expected in expected_srcs:
                    for cit in citations:
                        if cit.startswith(expected) or expected in cit:
                            citation_correct = True
                            break
                    if citation_correct:
                        break
            
            success = text_correct and citation_correct
            if text_correct:
                correct_count += 1
            if citation_correct:
                citation_correct_count += 1
                
            status_str = "✅ PASS" if success else "❌ FAIL"
            print(f"  Status: {status_str}")
            print(f"  Citations: {citations} (Expected: {expected_srcs} -> {'OK' if citation_correct else 'MISSING'})")
            if not text_correct:
                print(f"  Missing terms: {missing_terms}")
                
            results.append({
                "id": qid,
                "question": qtext,
                "reply": reply_text,
                "citations": citations,
                "text_correct": text_correct,
                "citation_correct": citation_correct,
                "success": success
            })
        except Exception as e:
            print(f"  💥 Error running question: {e}")
            results.append({
                "id": qid,
                "question": qtext,
                "reply": "",
                "citations": [],
                "text_correct": False,
                "citation_correct": False,
                "success": False,
                "error": str(e)
            })

    precision = (correct_count / total_count) * 100 if total_count > 0 else 0
    recall = (citation_correct_count / total_count) * 100 if total_count > 0 else 0
    success_rate = sum(1 for r in results if r["success"]) / total_count * 100 if total_count > 0 else 0
    
    report = (
        f"\n## Evaluation Report - {utc_now()}\n"
        f"- Total Questions: {total_count}\n"
        f"- Precision (Must contain match): {precision:.2f}%\n"
        f"- Recall (Citation match): {recall:.2f}%\n"
        f"- Success Rate (Both match): {success_rate:.2f}%\n"
    )
    
    print("\n================ EVALUATION SUMMARY ================")
    print(report)
    
    notes_path = Path("IMPLEMENTATION_NOTES.md")
    if notes_path.exists():
        with notes_path.open("a", encoding="utf-8") as f:
            f.write(report)
        print("📝 Appended evaluation results to IMPLEMENTATION_NOTES.md")

if __name__ == "__main__":
    try:
        asyncio.run(run_evaluation())
    finally:
        sys.exit(0)
