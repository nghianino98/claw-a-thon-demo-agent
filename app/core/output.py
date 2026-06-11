from __future__ import annotations

import re


_MD_FILE_LINK_RE = re.compile(r"\[[^\]\n]*\]\(\s*(?:kb:|[^)\n]*(?:/|\\|\.)[^)\n]*)\)", re.IGNORECASE)
_KB_LINK_RE = re.compile(r"\[[^\n]*?\]\(\s*kb:[^)]+\)", re.IGNORECASE)
_KB_URI_PAREN_RE = re.compile(r"\s*\(\s*kb:[^)]+\)", re.IGNORECASE)
_KB_URI_LINE_RE = re.compile(r"(?im)^\s*(?:[-*]\s*)?kb:[^\n]+$")
_BRACKETED_FILE_RE = re.compile(r"\s*\[[^\]\n]+\.(?:md|markdown|txt|pdf|docx?|xlsx?|csv|go|py|java|cpp|c|h|ts|js|json|sql|sh|yml|yaml|proto|xml)\]", re.IGNORECASE)
_PAREN_FILE_RE = re.compile(r"\s*\([^)\n]*\.(?:md|markdown|txt|pdf|docx?|xlsx?|csv|go|py|java|cpp|c|h|ts|js|json|sql|sh|yml|yaml|proto|xml)[^)\n]*\)", re.IGNORECASE)
_SOURCE_URL_RE = re.compile(r"\bSource:\s*https?://\S+", re.IGNORECASE)
_PATH_ONLY_LINE_RE = re.compile(
    r"(?im)^\s*(?:[-*]\s*)?(?:\d{2}\.\s*)?[^:\n]*(?:/|\\)?[^\n]+\.(?:md|markdown|txt|pdf|docx?|xlsx?|csv|go|py|java|cpp|c|h|ts|js|json|sql|sh|yml|yaml|proto|xml)\s*$"
)
_SOURCE_HEADING_RE = re.compile(r"^\s*(?:#{1,6}\s*)?(?:Nguồn|Sources?|References?)\s*:?\s*(.*)$", re.IGNORECASE)
_CITATION_INDICATOR_RE = re.compile(
    r"kb:|\[[^\]\n]+\]\([^)\n]+\)|(?:/|\\)?[^\n]+\.(?:md|markdown|txt|pdf|docx?|xlsx?|csv|go|py|java|cpp|c|h|ts|js|json|sql|sh|yml|yaml|proto|xml)|\.(?:md|markdown|txt|pdf|docx?|xlsx?|csv|go|py|java|cpp|c|h|ts|js|json|sql|sh|yml|yaml|proto|xml)\b",
    re.IGNORECASE,
)


def clean_user_visible_text(text: str) -> str:
    """Remove internal KB provenance markers from text shown to end users."""
    if not text:
        return ""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    cleaned = _strip_trailing_source_block(cleaned)
    cleaned = _MD_FILE_LINK_RE.sub("", cleaned)
    cleaned = _KB_LINK_RE.sub("", cleaned)
    cleaned = _KB_URI_PAREN_RE.sub("", cleaned)
    cleaned = _KB_URI_LINE_RE.sub("", cleaned)
    cleaned = _BRACKETED_FILE_RE.sub("", cleaned)
    cleaned = _PAREN_FILE_RE.sub("", cleaned)
    cleaned = _SOURCE_URL_RE.sub("", cleaned)
    cleaned = _PATH_ONLY_LINE_RE.sub("", cleaned)
    cleaned = re.sub(r"(?i)zalopay", "Zalopay", cleaned)
    return _normalize_after_citation_removal(cleaned)


def _strip_trailing_source_block(text: str) -> str:
    lines = text.rstrip().splitlines()
    if not lines:
        return text
    start = max(0, len(lines) - 14)
    for idx in range(len(lines) - 1, start - 1, -1):
        match = _SOURCE_HEADING_RE.match(lines[idx])
        if not match:
            continue
        block = "\n".join(lines[idx:])
        if _CITATION_INDICATOR_RE.search(block):
            return "\n".join(lines[:idx]).rstrip()
        break
    return text


def _normalize_after_citation_removal(text: str) -> str:
    text = re.sub(r"[ \t]+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"\[\s*\]", "", text)
    text = re.sub(r"(?m)^\s*[-*]\s*$", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
