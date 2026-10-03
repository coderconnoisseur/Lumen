"""Split documents into section-aligned chunks (SPEC-RAG, RAG-01). Pure functions, no I/O except PDF parsing.

A chunk never spans two sections: a clause stays together, a citation points at one place, and EVAL-02's
labels (`<doc id>#sNN`) match by construction. Long sections become overlapping pieces `#sNN-k`.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

MAX_WORDS = 260  # ~350 tokens
OVERLAP_WORDS = 40  # ~15%
_HEADING = re.compile(r"^(\d{1,2})\.\s+(\S.{0,80})$")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class Section:
    heading: str
    text: str


@dataclass(frozen=True)
class Chunk:
    id: str
    section_no: int
    piece_no: int
    heading: str
    text: str
    content_hash: str


def section_id(chunk_id: str) -> str:
    """`doc#s03-2` -> `doc#s03`: retrieval is scored per section."""
    return re.sub(r"-\d+$", "", chunk_id)


def _hash(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def _pieces(text: str, max_words: int, overlap_words: int) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [" ".join(words)]
    # Prefer to cut at sentence ends; fall back to a hard cut for run-on text.
    sentences = [s.split() for s in _SENTENCE_END.split(" ".join(words)) if s]
    pieces, current = [], []
    for sentence in sentences:
        if current and len(current) + len(sentence) > max_words:
            pieces.append(current)
            current = current[-overlap_words:] if overlap_words else []
        current = current + sentence
        while len(current) > max_words:
            pieces.append(current[:max_words])
            current = current[max_words - overlap_words:]
    if current and (not pieces or current != pieces[-1][-len(current):]):
        pieces.append(current)
    return [" ".join(p) for p in pieces]


def chunk_sections(doc_id: str, sections: list[Section], *, max_words: int = MAX_WORDS,
                   overlap_words: int = OVERLAP_WORDS) -> list[Chunk]:
    chunks = []
    for n, section in enumerate(sections, start=1):
        pieces = _pieces(section.text, max_words, overlap_words)
        for k, piece in enumerate(pieces):
            cid = f"{doc_id}#s{n:02d}" if len(pieces) == 1 else f"{doc_id}#s{n:02d}-{k}"
            chunks.append(Chunk(cid, n, k, section.heading, piece, _hash(section.heading, piece)))
    return chunks


def sections_from_text(text: str) -> tuple[str, list[Section]]:
    """(title, sections) from extracted text. Numbered headings (`1. Fees`, in order) start sections; without
    them, blank-line paragraphs do. Lines inside a section are joined with spaces (PDF line wraps)."""
    lines = [line.strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    title_lines, sections, heading, body, expected = [], [], None, [], 1
    for line in lines:
        match = _HEADING.match(line)
        if match and int(match.group(1)) == expected:
            if heading is not None:
                sections.append(Section(heading, " ".join(body)))
            heading, body, expected = match.group(2).strip(), [], expected + 1
        elif heading is None:
            title_lines.append(line)
        elif line:
            body.append(line)
    if heading is not None:
        sections.append(Section(heading, " ".join(body)))
        return " ".join(l for l in title_lines if l), sections

    paragraphs, current = [], []
    for line in lines + [""]:
        if line:
            current.append(line)
        elif current:
            paragraphs.append(" ".join(current))
            current = []
    if not paragraphs:
        return "", []
    title = paragraphs[0] if len(paragraphs) > 1 else ""
    return title, [Section("", p) for p in (paragraphs[1:] if title else paragraphs)]


def sections_from_pdf(data: bytes) -> tuple[str, list[Section]]:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(data)
    try:
        text = "\n".join(page.get_textpage().get_text_range() for page in pdf)
    finally:
        pdf.close()
    return sections_from_text(text)
