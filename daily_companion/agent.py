from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .config import AgentConfig, get_config
from .llm import OpenAICompatibleClient
from .memory import MemoryStore, extract_facts


class DailyCompanionAgent:
    def __init__(self, config: AgentConfig | None = None) -> None:
        self.config = config or get_config()
        self.memory = MemoryStore(self.config.memory_db_path)
        self.llm = OpenAICompatibleClient(
            base_url=self.config.llm_base_url,
            api_key=self.config.llm_api_key,
            model=self.config.llm_model,
            timeout_seconds=self.config.llm_timeout_seconds,
        )

    def respond(
        self,
        message: str,
        user_id: str = "default-user",
        session_id: str = "default-session",
    ) -> dict:
        clean_message = message.strip()
        if not clean_message:
            return {
                "status": "error",
                "error": "Message is required.",
            }

        self.memory.add_message(user_id, session_id, "user", clean_message)
        remembered = []
        for key, value in extract_facts(clean_message):
            self.memory.upsert_fact(user_id, key, value, clean_message)
            remembered.append({"key": key, "value": value})

        prompt_messages = self._build_messages(user_id, session_id)

        try:
            if self.config.has_llm:
                reply = self.llm.chat(prompt_messages).content
                mode = "llm"
            else:
                reply = self._fallback_reply(clean_message, user_id)
                mode = "fallback"
        except Exception as exc:
            reply = (
                "Mình đang bị hụt kết nối LLM một chút, nên trả lời bằng chế độ local nhé. "
                f"{self._fallback_reply(clean_message, user_id)}"
            )
            mode = f"fallback_after_llm_error: {exc}"

        self.memory.add_message(user_id, session_id, "assistant", reply)
        return {
            "status": "success",
            "response": reply,
            "remembered": remembered,
            "mode": mode,
            "agent_name": self.config.agent_name,
            "timestamp": datetime.now().isoformat(),
        }

    def _build_messages(self, user_id: str, session_id: str) -> list[dict[str, str]]:
        facts = self.memory.facts(user_id)
        facts_text = "\n".join(f"- {fact.key}: {fact.value}" for fact in facts)
        if not facts_text:
            facts_text = "- Chưa có memory nào về người dùng."

        now = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).strftime("%A, %Y-%m-%d %H:%M")
        system_prompt = f"""
Bạn là {self.config.agent_name}, một daily companion nói tiếng Việt.
Nhiệm vụ của bạn là trò chuyện hằng ngày một cách tự nhiên, vui vừa đủ, ấm áp,
không lên lớp và không biến mọi câu trả lời thành tư vấn dài dòng.

Phong cách:
- Xưng "mình" và gọi người dùng là "bạn" trừ khi memory nói cách gọi khác.
- Ưu tiên câu trả lời ngắn, có nhịp trò chuyện, giống một người bạn thông minh.
- Khi người dùng buồn hoặc mệt, phản hồi nhẹ nhàng và hỏi một câu nhỏ để họ dễ trả lời.
- Khi người dùng chỉ muốn nói chuyện chơi, đừng biến nó thành checklist.
- Có thể chủ động gợi một câu hỏi vui, một mini game chữ, hoặc một lời rủ rê nhẹ.
- Nếu người dùng yêu cầu lưu điều gì, hãy xác nhận tự nhiên rằng bạn đã nhớ.

Thời điểm hiện tại ở Việt Nam: {now}

Memory về người dùng:
{facts_text}
""".strip()

        history = self.memory.recent_messages(
            user_id, session_id, self.config.max_history_messages
        )
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend({"role": item.role, "content": item.content} for item in history)
        return messages

    def _fallback_reply(self, message: str, user_id: str) -> str:
        facts = self.memory.facts(user_id, limit=8)
        lowered = message.lower()

        if any(token in lowered for token in ("buồn", "mệt", "stress", "chán")):
            return (
                "Nghe có vẻ hôm nay hơi nặng nhỉ. Mình ngồi đây với bạn một chút. "
                "Chuyện đó là kiểu mệt thân, mệt đầu, hay mệt lòng?"
            )

        if any(token in lowered for token in ("hi", "hello", "chào", "alo")):
            return (
                f"Chào bạn, mình là {self.config.agent_name}. "
                "Hôm nay mình làm bạn tám chuyện nhé. Bạn đang muốn kể gì trước?"
            )

        if "?" in message:
            return (
                "Câu này hay đó. Nếu bật LLM thì mình sẽ trả lời sâu hơn, "
                "còn bản local hiện tại mình đoán bạn đang muốn một góc nhìn thân thiện. "
                "Bạn kể thêm bối cảnh một chút được không?"
            )

        if facts:
            memory_hint = f"Mình vẫn nhớ {facts[0].key}: {facts[0].value}."
        else:
            memory_hint = "Mình chưa biết nhiều về bạn, nhưng đang học dần từ mỗi lần trò chuyện."

        return (
            f"Mình nghe rồi. {memory_hint} "
            "Kể tiếp đi, hoặc nếu muốn đổi mood thì mình có thể bày một câu hỏi vui cho hôm nay."
        )

    def list_memories(self, user_id: str = "default-user") -> list[dict[str, str]]:
        return [fact.__dict__ for fact in self.memory.facts(user_id)]

    def clear_memories(self, user_id: str = "default-user") -> None:
        self.memory.clear_user(user_id)
