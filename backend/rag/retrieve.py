"""`search_documents`: the retrieval entry point the agent and the answer path call (SPEC-RAG).

Modes, so the ablation runs the same code with one switch:
  dense          - vector search only
  hybrid         - dense + BM25, fused with Reciprocal Rank Fusion
  hybrid_rerank  - hybrid, then a cross-encoder reorders the top candidates (the production mode)
"""
from __future__ import annotations

from rag.embed import Embedder
from rag.store import ChunkStore, Hit

MODES = ("dense",)


def search_documents(store: ChunkStore, embedder: Embedder, user_id: str, query: str, *, mode: str = "dense",
                     k: int = 10) -> list[Hit]:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    return store.dense_search(user_id, embedder.embed_query(query), k=k)
