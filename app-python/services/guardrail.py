from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from app.settings import Settings


REFUSAL_TEXT = (
    "Xin lỗi, mình không hỗ trợ nội dung liên quan đến bảo mật hệ thống, "
    "thông tin nhạy cảm hay truy cập ngoài phạm vi tài liệu sản phẩm. "
    "Mình sẵn sàng giúp bạn các câu hỏi về nghiệp vụ Wealth Solution nhé."
)


DEFAULT_PATTERNS: dict[str, list[str]] = {
    "secret_request": [
        r"\b(api[_\s-]?key|secret|token|credential|password|passwd|private[_\s-]?key|access[_\s-]?key)\b",
        r"\b(bearer|authorization)\s+token\b",
        r"\b(connection[_\s-]?string|database\s+url|db\s+credential)\b",
        r"\b(env\s+var|environment\s+variable|\.env)\b",
        r"\b(kh[oô]a\s+b[ií]\s*m[aậ]t|m[aậ]t\s+kh[aẩ]u|th[oô]ng\s+tin\s+nh[aạ]y\s+c[aả]m)\b",
    ],
    "prompt_injection": [
        r"\b(ignore|bypass|override)\s+(all\s+)?(previous|system|developer)\s+(instructions?|prompt)\b",
        r"\b(system|developer)\s+prompt\b",
        r"\bin\s+ra\s+(to[aà]n\s+b[oộ]\s+)?(system\s+prompt|prompt\s+h[eệ]\s+th[oố]ng)\b",
        r"\bb[oỏ]\s+qua\s+(mọi\s+)?(hướng\s+dẫn|chỉ\s+thị)\b",
    ],
    "out_of_scope_file_access": [
        r"(^|[\s\"'`])\.\./",
        r"\b(read|cat|open|dump|print)\s+file\b.*\b(\.env|/etc/passwd|secret|token)\b",
        r"\b(đ[oọ]c|in|mở|mo)\s+(file|tệp)\b.*\b(\.env|secret|token|credential)\b",
    ],
    "abuse_or_bypass": [
        r"\b(bypass|exploit|hack|malware|phishing|privilege\s+escalation)\b",
        r"\b(bypass|l[aá]ch|vượt)\b.*\b(limit|kyc|otp|risk|fraud|control|kiểm\s+so[aá]t)\b",
        r"\b(c[aá]ch|how)\b.*\b(gian\s+l[aậ]n|r[uú]t\s+ti[eề]n\s+tr[aá]i|qua\s+mặt)\b",
    ],
}


@dataclass(frozen=True)
class GuardrailMatch:
    category: str
    prompt_hash: str


class GuardrailService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.patterns = self._load_patterns(settings.guardrail_config)

    def reload(self) -> None:
        self.patterns = self._load_patterns(self.settings.guardrail_config)

    def check(self, text: str) -> GuardrailMatch | None:
        prompt_hash = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
        for category, patterns in self.patterns.items():
            for pattern in patterns:
                if re.search(pattern, text, flags=re.IGNORECASE | re.UNICODE):
                    return GuardrailMatch(category=category, prompt_hash=prompt_hash)
        return None

    @staticmethod
    def _load_patterns(path: Path) -> dict[str, list[str]]:
        patterns = {category: list(values) for category, values in DEFAULT_PATTERNS.items()}
        if not path.exists():
            return patterns

        current_category: str | None = None
        for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            stripped = raw_line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if not raw_line.startswith((" ", "\t")) and stripped.endswith(":"):
                current_category = stripped[:-1].strip()
                patterns.setdefault(current_category, [])
                continue
            if current_category and stripped.startswith("- "):
                pattern = stripped[2:].strip().strip("'\"")
                if pattern:
                    patterns.setdefault(current_category, []).append(pattern)
        return patterns
