"""Per-user BM25 keyword search (SPEC-RAG, RAG-03).

Vectors match meaning but blur exact identifiers: on the eval corpus, dense search found the right section for
37/37 contract questions but only 16/53 purchase-order questions, because twelve POs differ mostly by their
number. BM25 weights rare exact terms, and a PO number is the rarest term there is.

The index is built from one user's chunks (tenant-isolated by construction), kept in memory, and rebuilt when
that user's chunk set changes. Honest limit: fine up to tens of thousands of chunks per user.
"""
from __future__ import annotations

import re
import threading

import bm25s

from rag.ingest import passage_text
from rag.store import ChunkStore

STOPWORDS = frozenset(
    "a an and are as at be by can did do does for from has have how i in is it its me my of on or our the their "
    "this to us was we what when where which who why will with you your s t".split()
)
_CODE = re.compile(r"[a-z0-9]+(?:[-/][a-z0-9]+)+")
_WORD = re.compile(r"[a-z0-9]+")

_lock = threading.Lock()
_indexes: dict[tuple[str, str], tuple[tuple, list[str], bm25s.BM25 | None]] = {}


def tokenize(text: str) -> list[str]:
    """Lowercase words without stopwords, plus whole codes like `po-u1-202507-01` (their parts stay too)."""
    lowered = text.lower()
    words = [w for w in _WORD.findall(lowered) if w not in STOPWORDS]
    return words + _CODE.findall(lowered)


def _index(store: ChunkStore, user_id: str) -> tuple[list[str], bm25s.BM25 | None]:
    key = (str(store.engine.url), user_id)
    version = store.user_version(user_id)
    with _lock:
        cached = _indexes.get(key)
        if cached and cached[0] == version:
            return cached[1], cached[2]
    rows = store.user_chunks(user_id)
    ids = [r[0] for r in rows]
    retriever = None
    if rows:
        retriever = bm25s.BM25()
        retriever.index([tokenize(passage_text(title, heading or "", text)) for _, title, heading, text in rows],
                        show_progress=False)
    with _lock:
        _indexes[key] = (version, ids, retriever)
    return ids, retriever


def bm25_search(store: ChunkStore, user_id: str, query: str, k: int = 50) -> list[tuple[str, float]]:
    """The user's top-k (chunk id, score) by BM25; chunks sharing no term with the query are left out."""
    ids, retriever = _index(store, user_id)
    tokens = tokenize(query)
    if retriever is None or not tokens:
        return []
    docs, scores = retriever.retrieve([tokens], k=min(k, len(ids)), show_progress=False)
    ranked = [(ids[int(d)], float(s)) for d, s in zip(docs[0], scores[0]) if s > 0]
    return sorted(ranked, key=lambda pair: (-pair[1], pair[0]))
