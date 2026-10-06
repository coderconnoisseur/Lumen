"""Turn a document into stored, embedded chunks (SPEC-RAG). Re-ingesting the same content is a no-op."""
from __future__ import annotations

import uuid

from rag.chunking import Section, chunk_sections, sections_from_pdf
from rag.embed import Embedder
from rag.store import ChunkStore


def passage_text(title: str, heading: str, text: str) -> str:
    """What gets embedded and keyword-indexed: the chunk plus its document title and section heading
    ("contextual chunk header"), so "Payment is due Net 30" is findable by the PO number in the title."""
    return "\n".join(part for part in (title, heading, text) if part)


def ingest_sections(store: ChunkStore, embedder: Embedder, *, user_id: str, title: str, sections: list[Section],
                    doc_type: str = "other", filename: str | None = None, doc_id: str | None = None) -> str:
    doc_id = doc_id or str(uuid.uuid4())
    chunks = chunk_sections(doc_id, sections)
    if not chunks:
        raise ValueError("no text found in the document")
    vectors = embedder.embed_passages([passage_text(title, c.heading, c.text) for c in chunks])
    return store.upsert_document(doc_id=doc_id, user_id=user_id, title=title, doc_type=doc_type, filename=filename,
                                 chunks=chunks, vectors=vectors, embedding_model=embedder.model_id)


def ingest_pdf(store: ChunkStore, embedder: Embedder, *, user_id: str, data: bytes, filename: str | None = None,
               doc_type: str = "other", doc_id: str | None = None) -> str:
    title, sections = sections_from_pdf(data)
    return ingest_sections(store, embedder, user_id=user_id, title=title or (filename or "Untitled"),
                           sections=sections, doc_type=doc_type, filename=filename, doc_id=doc_id)
