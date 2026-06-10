from __future__ import annotations

import argparse
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path


SUPPORTED_EXTENSIONS = {".md", ".markdown", ".txt", ".csv"}
SKIP_DIRS = {".git", ".next", ".venv", "venv", "node_modules", "__pycache__"}


@dataclass(frozen=True)
class KnowledgeHit:
    source_path: str
    title: str
    content: str
    score: float


class KnowledgeBase:
    def __init__(self, index_path: str) -> None:
        self.index_path = index_path

    @property
    def available(self) -> bool:
        return Path(self.index_path).exists()

    def stats(self) -> dict:
        if not self.available:
            return {"available": False, "chunks": 0, "sources": 0}

        with sqlite3.connect(self.index_path) as conn:
            chunks = conn.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]
            sources = conn.execute(
                "SELECT COUNT(DISTINCT source_path) FROM chunks_fts"
            ).fetchone()[0]
        return {"available": True, "chunks": chunks, "sources": sources}

    def search(self, query: str, limit: int = 5) -> list[KnowledgeHit]:
        if not self.available or not query.strip() or limit <= 0:
            return []

        match_query = build_match_query(query)
        if not match_query:
            return []

        try:
            with sqlite3.connect(self.index_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """
                    SELECT source_path, title, content, bm25(chunks_fts) AS score
                    FROM chunks_fts
                    WHERE chunks_fts MATCH ?
                    ORDER BY score
                    LIMIT ?
                    """,
                    (match_query, limit * 5),
                ).fetchall()
        except sqlite3.Error:
            rows = []

        hits = [
            KnowledgeHit(
                source_path=row["source_path"],
                title=row["title"],
                content=row["content"],
                score=rerank_score(query, row["source_path"], row["title"], float(row["score"])),
            )
            for row in rows
        ]
        hits.sort(key=lambda hit: hit.score)
        return hits[:limit]


def build_match_query(query: str) -> str:
    terms = []
    for term in re.findall(r"[\wÀ-ỹ]+", query.lower(), flags=re.UNICODE):
        if len(term) >= 2 and not term.isdigit():
            terms.append(term)
    return " OR ".join(f'"{term}"' for term in terms[:12])


def rerank_score(query: str, source_path: str, title: str, score: float) -> float:
    query_lower = query.lower()
    haystack = f"{source_path} {title}".lower()
    product_aliases = {
        "fd": ("fd", "fixed deposit"),
        "mmf": ("mmf", "money market fund"),
        "fi": ("fi", "fixed income"),
        "insurance": ("insurance", "bảo hiểm", "bao hiem"),
    }

    for canonical, aliases in product_aliases.items():
        if any(alias in query_lower for alias in aliases):
            if canonical in haystack or any(alias in haystack for alias in aliases):
                score -= 10.0
    return score


def build_index(source_dir: str, index_path: str) -> dict:
    source_root = Path(source_dir).expanduser().resolve()
    if not source_root.exists():
        raise FileNotFoundError(f"Knowledge source not found: {source_root}")

    index = Path(index_path).expanduser().resolve()
    if index.exists():
        index.unlink()

    index.parent.mkdir(parents=True, exist_ok=True)
    files = list(iter_supported_files(source_root))
    chunk_count = 0

    with sqlite3.connect(index) as conn:
        conn.execute(
            """
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                source_path,
                title,
                content,
                tokenize='unicode61'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        for file_path in files:
            text = read_text_file(file_path)
            if not text.strip():
                continue
            title = title_for(file_path, source_root)
            relative_path = str(file_path.relative_to(source_root))
            for chunk in chunk_text(text):
                conn.execute(
                    """
                    INSERT INTO chunks_fts (source_path, title, content)
                    VALUES (?, ?, ?)
                    """,
                    (relative_path, title, chunk),
                )
                chunk_count += 1

        conn.executemany(
            "INSERT INTO metadata (key, value) VALUES (?, ?)",
            [
                ("source_dir", str(source_root)),
                ("file_count", str(len(files))),
                ("chunk_count", str(chunk_count)),
            ],
        )

    return {
        "source_dir": str(source_root),
        "index_path": str(index),
        "file_count": len(files),
        "chunk_count": chunk_count,
    }


def iter_supported_files(source_root: Path):
    for file_path in source_root.rglob("*"):
        if not file_path.is_file():
            continue
        if any(part in SKIP_DIRS or part.startswith(".") for part in file_path.parts):
            continue
        if file_path.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield file_path


def read_text_file(file_path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return file_path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return ""


def title_for(file_path: Path, source_root: Path) -> str:
    try:
        text = file_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return file_path.stem
    for line in text.splitlines()[:40]:
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or file_path.stem
    return str(file_path.relative_to(source_root))


def chunk_text(text: str, max_chars: int = 1400, overlap: int = 180) -> list[str]:
    cleaned = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not cleaned:
        return []

    paragraphs = re.split(r"\n\s*\n", cleaned)
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(current) + len(paragraph) + 2 <= max_chars:
            current = f"{current}\n\n{paragraph}".strip()
            continue
        if current:
            chunks.append(current)
        if len(paragraph) <= max_chars:
            current = paragraph
        else:
            chunks.extend(split_long_text(paragraph, max_chars, overlap))
            current = ""

    if current:
        chunks.append(current)

    return chunks


def split_long_text(text: str, max_chars: int, overlap: int) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        chunks.append(text[start:end].strip())
        if end == len(text):
            break
        start = max(0, end - overlap)
    return [chunk for chunk in chunks if chunk]


def format_hits_for_prompt(hits: list[KnowledgeHit], max_chars: int) -> str:
    if not hits:
        return ""

    parts = []
    total = 0
    for index, hit in enumerate(hits, start=1):
        header = f"[{index}] {hit.title} ({hit.source_path})"
        remaining = max_chars - total - len(header) - 8
        if remaining <= 0:
            break
        content = hit.content[:remaining].strip()
        if not content:
            continue
        part = f"{header}\n{content}"
        parts.append(part)
        total += len(part)
    return "\n\n---\n\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a local knowledge index")
    parser.add_argument("--source", required=True)
    parser.add_argument("--index", default=".knowledge_base.sqlite3")
    args = parser.parse_args()
    result = build_index(args.source, args.index)
    print(result)


if __name__ == "__main__":
    main()
