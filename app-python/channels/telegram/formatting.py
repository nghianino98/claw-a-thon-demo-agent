from __future__ import annotations

import html
import re


_PLACEHOLDER = "@@TGHTML{}@@"
_CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
_HTTP_LINK_RE = re.compile(r"\[([^\n]+?)\]\((https?://[^\s)]+)\)")
_KB_LINK_RE = re.compile(r"\[([^\n]+?)\]\((kb:[^)]+)\)")


def render_telegram_html(text: str) -> str:
    """Render a conservative Markdown subset into Telegram-safe HTML."""
    if not text:
        return ""

    normalized = _normalize_markdown(text)
    rendered: list[str] = []
    code_lines: list[str] = []
    in_code_block = False

    for raw_line in normalized.splitlines():
        if raw_line.strip().startswith("```"):
            if in_code_block:
                rendered.append("<pre>" + html.escape("\n".join(code_lines)) + "</pre>")
                code_lines = []
                in_code_block = False
            else:
                in_code_block = True
            continue

        if in_code_block:
            code_lines.append(raw_line)
            continue

        line = _format_block_line(raw_line)
        rendered.append(_render_inline(line))

    if in_code_block:
        rendered.append("<pre>" + html.escape("\n".join(code_lines)) + "</pre>")

    return "\n".join(rendered).strip()


def _normalize_markdown(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    replacements = {
        r"\Rightarrow": "->",
        r"\rightarrow": "->",
        r"\leftarrow": "<-",
        r"\to": "->",
    }
    for marker, replacement in replacements.items():
        normalized = normalized.replace(f"${marker}$", replacement)
        normalized = normalized.replace(marker, replacement)
    normalized = normalized.replace("\\$", "$")
    return normalized


def _format_block_line(line: str) -> str:
    heading = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", line)
    if heading:
        return f"**{heading.group(1)}**"

    bullet = re.match(r"^(\s*)[-*]\s+(.+)$", line)
    if bullet:
        level = min(len(bullet.group(1).expandtabs(2)) // 2, 3)
        return ("  " * level) + "- " + bullet.group(2)

    return line


def _render_inline(line: str) -> str:
    placeholders: list[str] = []

    def stash(value: str) -> str:
        placeholders.append(value)
        return _PLACEHOLDER.format(len(placeholders) - 1)

    def code_replacement(match: re.Match[str]) -> str:
        return stash(f"<code>{html.escape(match.group(1))}</code>")

    def kb_link_replacement(match: re.Match[str]) -> str:
        return stash(html.escape(_clean_link_label(match.group(1))))

    def http_link_replacement(match: re.Match[str]) -> str:
        label = html.escape(_clean_link_label(match.group(1)))
        url = html.escape(match.group(2), quote=True)
        return stash(f'<a href="{url}">{label}</a>')

    prepared = _CODE_SPAN_RE.sub(code_replacement, line)
    prepared = _KB_LINK_RE.sub(kb_link_replacement, prepared)
    prepared = _HTTP_LINK_RE.sub(http_link_replacement, prepared)
    escaped = html.escape(prepared)

    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"__(.+?)__", r"<b>\1</b>", escaped)
    escaped = re.sub(r"~~(.+?)~~", r"<s>\1</s>", escaped)

    for index, value in enumerate(placeholders):
        escaped = escaped.replace(html.escape(_PLACEHOLDER.format(index)), value)
        escaped = escaped.replace(_PLACEHOLDER.format(index), value)
    return escaped


def _clean_link_label(label: str) -> str:
    return label.replace("\\[", "[").replace("\\]", "]").strip()
