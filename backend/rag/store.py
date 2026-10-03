"""Chunk store (SPEC-RAG, RAG-01): documents and their embedded chunks in the app database.

Every read takes a `user_id` and filters on it in SQL: tenant isolation lives here, never in a prompt.
Dense search is exact: pgvector's cosine distance on Postgres, a numpy dot product on SQLite.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np
from sqlalchemy import Float, bindparam, delete, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import models  # noqa: F401  (registers the tables)
from models import Document, DocumentChunk, EmbeddingVector
from models.database import db
from rag.chunking import Chunk


@dataclass(frozen=True)
class Hit:
    chunk_id: str
    doc_id: str
    score: float
    heading: str
    text: str
    title: str = ""
    doc_type: str = ""


def ensure_vector_extension(conn) -> None:
    """pgvector must exist before the chunk table on Postgres (Supabase and Render allow it)."""
    if conn.dialect.name == "postgresql":
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))


class ChunkStore:
    def __init__(self, engine: Engine):
        self.engine = engine
        self.postgres = engine.dialect.name == "postgresql"

    def ensure_schema(self) -> None:
        with self.engine.begin() as conn:
            ensure_vector_extension(conn)
        tables = [db.metadata.tables["documents"], db.metadata.tables["document_chunks"]]
        db.metadata.create_all(self.engine, tables=tables)

    # --- writes ---------------------------------------------------------------------------

    def upsert_document(self, *, doc_id: str, user_id: str, title: str, doc_type: str, filename: str | None,
                        chunks: list[Chunk], vectors: np.ndarray, embedding_model: str) -> str:
        """Store a document's chunks; returns the document id. Same user + same content -> the existing id."""
        content_hash = hashlib.sha256("\x1e".join(c.content_hash for c in chunks).encode()).hexdigest()
        with Session(self.engine) as session, session.begin():
            existing = session.scalar(select(Document.id).where(
                Document.user_id == user_id, Document.content_hash == content_hash))
            if existing:
                return existing
            session.add(Document(id=doc_id, user_id=user_id, title=title, doc_type=doc_type, filename=filename,
                                 content_hash=content_hash, embedding_model=embedding_model, chunk_count=len(chunks)))
            session.flush()
            session.add_all(DocumentChunk(
                id=c.id, document_id=doc_id, user_id=user_id, section_no=c.section_no, piece_no=c.piece_no,
                heading=c.heading, text=c.text, content_hash=c.content_hash, embedding=vector,
                embedding_model=embedding_model,
            ) for c, vector in zip(chunks, vectors))
        return doc_id

    def delete_document(self, user_id: str, doc_id: str) -> bool:
        with Session(self.engine) as session, session.begin():
            owned = session.scalar(select(Document.id).where(Document.id == doc_id, Document.user_id == user_id))
            if not owned:
                return False
            session.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
            session.execute(delete(Document).where(Document.id == doc_id))
        return True

    def delete_user(self, user_id: str) -> None:
        with Session(self.engine) as session, session.begin():
            session.execute(delete(DocumentChunk).where(DocumentChunk.user_id == user_id))
            session.execute(delete(Document).where(Document.user_id == user_id))

    # --- reads ----------------------------------------------------------------------------

    def list_documents(self, user_id: str) -> list[dict]:
        with Session(self.engine) as session:
            rows = session.scalars(select(Document).where(Document.user_id == user_id)
                                   .order_by(Document.created_at.desc(), Document.id)).all()
            return [{"id": d.id, "title": d.title, "doc_type": d.doc_type, "filename": d.filename,
                     "chunk_count": d.chunk_count, "created_at": d.created_at.isoformat() if d.created_at else None}
                    for d in rows]

    def user_chunks(self, user_id: str) -> list[tuple[str, str, str, str]]:
        """(chunk id, title, heading, text) for every chunk of the user's, in a stable order (BM25 input)."""
        with Session(self.engine) as session:
            rows = session.execute(
                select(DocumentChunk.id, Document.title, DocumentChunk.heading, DocumentChunk.text)
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(DocumentChunk.user_id == user_id).order_by(DocumentChunk.id)).all()
            return [tuple(r) for r in rows]

    def user_version(self, user_id: str) -> tuple:
        """Changes whenever the user's chunks change: the BM25 cache key."""
        with Session(self.engine) as session:
            count, newest = session.execute(
                select(func.count(DocumentChunk.id), func.max(DocumentChunk.id)).where(DocumentChunk.user_id == user_id)).one()
            docs = session.scalar(select(func.count(Document.id)).where(Document.user_id == user_id))
            return (count, newest, docs)

    def chunks_by_id(self, user_id: str, chunk_ids: list[str]) -> dict[str, Hit]:
        if not chunk_ids:
            return {}
        with Session(self.engine) as session:
            rows = session.execute(
                select(DocumentChunk.id, DocumentChunk.document_id, DocumentChunk.heading, DocumentChunk.text,
                       Document.title, Document.doc_type)
                .join(Document, Document.id == DocumentChunk.document_id)
                .where(DocumentChunk.user_id == user_id, DocumentChunk.id.in_(chunk_ids))).all()
            return {r[0]: Hit(r[0], r[1], 0.0, r[2] or "", r[3], r[4], r[5]) for r in rows}

    def dense_search(self, user_id: str, query: np.ndarray, k: int = 50) -> list[Hit]:
        """The user's top-k chunks by cosine similarity (vectors are normalised). Ties break by chunk id."""
        if self.postgres:
            with Session(self.engine) as session:
                q = bindparam("q", value=np.asarray(query, dtype=np.float32).tolist(), type_=EmbeddingVector())
                dist = DocumentChunk.embedding.op("<=>", return_type=Float)(q)
                rows = session.execute(
                    select(DocumentChunk.id, (1 - dist).label("score"))
                    .where(DocumentChunk.user_id == user_id).order_by(dist, DocumentChunk.id).limit(k)).all()
            scored = [(r[0], float(r[1])) for r in rows]
        else:
            with Session(self.engine) as session:
                rows = session.execute(select(DocumentChunk.id, DocumentChunk.embedding)
                                       .where(DocumentChunk.user_id == user_id)).all()
            if not rows:
                return []
            ids = [r[0] for r in rows]
            scores = np.stack([r[1] for r in rows]) @ np.asarray(query, dtype=np.float32)
            order = sorted(range(len(ids)), key=lambda i: (-float(scores[i]), ids[i]))[:k]
            scored = [(ids[i], float(scores[i])) for i in order]
        details = self.chunks_by_id(user_id, [cid for cid, _ in scored])
        return [Hit(cid, details[cid].doc_id, score, details[cid].heading, details[cid].text,
                    details[cid].title, details[cid].doc_type) for cid, score in scored]
