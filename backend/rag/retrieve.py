"""`search_documents`: the retrieval entry point the agent and the answer path call (SPEC-RAG).

Modes, so the ablation runs the same code with one switch:
  dense          - vector search only
  hybrid         - dense + BM25, fused with Reciprocal Rank Fusion
  hybrid_rerank  - hybrid, then a cross-encoder reorders the top candidates (the production mode)
Every mode reads only the asking user's chunks (the store and the BM25 index are per user).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import replace

from rag.bm25 import bm25_search
from rag.embed import Embedder
from rag.ingest import passage_text
from rag.rerank import Reranker
from rag.store import ChunkStore, Hit

MODES = ("dense", "hybrid", "hybrid_rerank")
RRF_K = 60
CANDIDATES = 50  # taken from each retriever before fusing
# Fused candidates the cross-encoder rescores. Chosen on the dev split (2026-10-04): with MiniLM-L-12, 15
# candidates gave the same hit@5 as 30 (100/104) with a slightly better MRR, at half the latency (~0.6 s vs
# ~1.2 s on a laptop CPU); 10 dropped to 92/104.
RERANK_CANDIDATES = 15


def rrf(rankings: list[list[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion: score = sum of 1 / (k + rank) over the lists an item appears in.

    Uses ranks only, so BM25 scores and cosine similarities never need to be put on one scale.
    Ties break by id, so results are deterministic.
    """
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] += 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))


def search_documents(store: ChunkStore, embedder: Embedder, user_id: str, query: str, *, mode: str = "hybrid_rerank",
                     k: int = 10, reranker: Reranker | None = None) -> list[Hit]:
    """The user's top-k chunks. In `hybrid_rerank`, `Hit.score` is the reranker's relevance score."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if mode == "hybrid_rerank" and reranker is None:
        raise ValueError("hybrid_rerank needs a reranker")
    dense = store.dense_search(user_id, embedder.embed_query(query), k=CANDIDATES if mode != "dense" else k)
    if mode == "dense":
        return dense
    keyword = bm25_search(store, user_id, query, k=CANDIDATES)
    fused = rrf([[h.chunk_id for h in dense], [cid for cid, _ in keyword]])
    fused = fused[:RERANK_CANDIDATES] if mode == "hybrid_rerank" else fused[:k]
    details = {h.chunk_id: h for h in dense}
    details.update(store.chunks_by_id(user_id, [cid for cid, _ in fused if cid not in details]))
    hits = [Hit(cid, details[cid].doc_id, score, details[cid].heading, details[cid].text,
                details[cid].title, details[cid].doc_type) for cid, score in fused]
    if mode == "hybrid":
        return hits
    scores = reranker.score(query, [passage_text(h.title, h.heading, h.text) for h in hits])
    ranked = sorted(zip(hits, scores), key=lambda pair: (-pair[1], pair[0].chunk_id))[:k]
    return [replace(h, score=float(s)) for h, s in ranked]
