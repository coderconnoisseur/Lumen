"""The app's RAG service: one store, embedder and reranker per process, created on first use (SPEC-RAG).

Models load lazily so importing the app stays fast and tests never download them; the API receives this
service through a FastAPI dependency, which tests override with fakes.
"""
from __future__ import annotations

import logging
import threading

from rag.answer import CONTEXT_CHUNKS, answer_from_hits
from rag.embed import Embedder, FastEmbedder
from rag.ingest import ingest_pdf
from rag.rerank import FlashReranker, Reranker
from rag.retrieve import search_documents
from rag.store import ChunkStore

logger = logging.getLogger(__name__)
DOC_TYPES = ("purchase_order", "contract", "policy", "invoice", "other")


class RagService:
    def __init__(self, store: ChunkStore, embedder: Embedder, reranker: Reranker, llm=None):
        self.store, self.embedder, self.reranker = store, embedder, reranker
        self._llm = llm

    def llm(self, prompt, **kwargs):
        if self._llm is not None:
            return self._llm(prompt, **kwargs)
        from utils.llm import chat_completion

        return chat_completion(prompt, **kwargs)

    def ingest(self, user_id: str, data: bytes, filename: str, doc_type: str) -> dict:
        doc_id = ingest_pdf(self.store, self.embedder, user_id=user_id, data=data, filename=filename, doc_type=doc_type)
        return next(d for d in self.store.list_documents(user_id) if d["id"] == doc_id)

    def search(self, user_id: str, query: str, k: int = 5):
        return search_documents(self.store, self.embedder, user_id, query, k=k, reranker=self.reranker)

    def ask(self, user_id: str, question: str) -> dict:
        hits = self.search(user_id, question, k=CONTEXT_CHUNKS)
        out = answer_from_hits(question, hits, llm=self.llm)
        logger.info("documents ask: abstained=%s reason=%s top_score=%s retrieved=%s cited=%s", out["abstained"],
                    out["reason"], f"{hits[0].score:.3f}" if hits else None, len(hits), len(out["citations"]))
        by_id = {h.chunk_id: h for h in hits}
        out["sources"] = [{"chunk_id": cid, "document_id": by_id[cid].doc_id, "title": by_id[cid].title,
                           "section": by_id[cid].heading, "text": by_id[cid].text} for cid in out["citations"]]
        return out


_lock = threading.Lock()
_service: RagService | None = None


def get_service() -> RagService:
    global _service
    with _lock:
        if _service is None:
            from sqlalchemy import create_engine

            from config import Config

            store = ChunkStore(create_engine(Config.DATABASE_URI, pool_pre_ping=True))
            store.ensure_schema()
            _service = RagService(store, FastEmbedder(), FlashReranker())
        return _service
