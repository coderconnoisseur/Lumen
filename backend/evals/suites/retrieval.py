"""Retrieval suite (SPEC-RAG RAG-07): the EVAL-02 retrieval questions against the 20-document corpus, per
retrieval mode, so the README ablation table comes from one run. No LLM calls.

The corpus PDFs go through the real ingest path into a throwaway SQLite store, under each document's owner.
A retrieved chunk counts as its section (`#sNN-k` -> `#sNN`); repeats of a section are dropped from the
ranking. Embeddings come from a committed cache (`evals/cassettes/embeddings/`), so CI runs offline;
`--record` fills missing vectors with the local model (no API, no quota).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from sqlalchemy import create_engine

from evals.generator.world import build_world
from evals.metrics import mrr, ndcg_at_k, rate, recall_at_k
from evals.suites.common import DATA_DIR, EVALS_DIR, load_rows
from rag.chunking import section_id
from rag.embed import DEFAULT_MODEL, CachedEmbedder, EmbeddingMiss, FastEmbedder
from rag.ingest import ingest_pdf
from rag.retrieve import MODES, search_documents
from rag.store import ChunkStore

SUITE = "retrieval"
GATED_MODE = MODES[-1]  # the production mode decides pass/fail per case
CACHE = EVALS_DIR / "cassettes" / "embeddings" / f"{DEFAULT_MODEL.split('/')[-1]}.jsonl"
DEPTH = 10


def embedder(cache: Path = CACHE):
    record = (os.getenv("LUMEN_LLM_CACHE") or "replay") == "record"
    return CachedEmbedder(cache, FastEmbedder() if record else None, mode="record" if record else "replay")


def build_store(emb, users: dict[str, str]) -> ChunkStore:
    path = Path(tempfile.mkdtemp(prefix="lumen-eval-rag-")) / "rag.db"
    store = ChunkStore(create_engine(f"sqlite:///{path}"))
    store.ensure_schema()
    for line in (DATA_DIR / "corpus.jsonl").read_text(encoding="utf-8").splitlines():
        doc = json.loads(line)
        ingest_pdf(store, emb, user_id=users[doc["user"]], data=(DATA_DIR / doc["file"]).read_bytes(),
                   filename=Path(doc["file"]).name, doc_type=doc["kind"], doc_id=doc["id"])
    return store


def ranked_sections(hits) -> list[str]:
    seen, ranked = set(), []
    for hit in hits:
        sid = section_id(hit.chunk_id)
        if sid not in seen:
            seen.add(sid)
            ranked.append(sid)
    return ranked


def run(tier: str, split: str, *, emb=None) -> dict:
    users = {u["key"]: u["id"] for u in build_world(42)["users"]}
    emb = emb or embedder()
    try:
        store = build_store(emb, users)
    except EmbeddingMiss as miss:
        return {"cases": {}, "metrics": {}, "hard_gate_failures": [f"embedding cache miss: {miss}"]}
    rows = load_rows(SUITE, split)
    per_mode, cases, misses = {}, {}, []
    for mode in MODES:
        r5 = r10 = rr = nd = 0.0
        hit5 = 0
        for row in rows:
            try:
                ranked = ranked_sections(search_documents(store, emb, users[row["user"]], row["question"],
                                                          mode=mode, k=DEPTH * 3))[:DEPTH]
            except EmbeddingMiss as miss:
                misses.append(f"embedding cache miss: {row['id']}: {miss}")
                continue
            relevant = set(row["relevant_chunk_ids"])
            r5 += recall_at_k(ranked, relevant, 5)
            r10 += recall_at_k(ranked, relevant, 10)
            rr += mrr(ranked, relevant)
            nd += ndcg_at_k(ranked, relevant, 10)
            found = bool(relevant & set(ranked[:5]))
            hit5 += found
            if mode == GATED_MODE:
                cases[row["id"]] = found
        n = len(rows)
        per_mode[mode] = {
            "recall_at_5": round(r5 / n, 4), "recall_at_10": round(r10 / n, 4),
            "mrr": round(rr / n, 4), "ndcg_at_10": round(nd / n, 4),
            "hit_at_5": rate(hit5, n),
        }
    return {
        "cases": cases,
        "metrics": {"gated_mode": GATED_MODE, "embedding_model": emb.model_id, "modes": per_mode},
        "hard_gate_failures": sorted(set(misses)),
    }
