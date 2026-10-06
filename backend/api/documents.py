"""Documents API (SPEC-RAG): upload, list, delete, search and ask. The first FastAPI-native routes; auth, rate
limits and error bodies come from api/deps.py and api/errors.py (API-01 parity)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.deps import current_user, rate_limit
from config import Config
from rag.service import DOC_TYPES, RagService, get_service

router = APIRouter(prefix="/api/documents", tags=["documents"])


class Query(BaseModel):
    query: str = Field(min_length=1, max_length=500)


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=500)


@router.post("", dependencies=[Depends(rate_limit("10 per minute"))])
def upload(file: UploadFile = File(...), doc_type: str = Form("other"), claims: dict = Depends(current_user),
           rag: RagService = Depends(get_service)):
    data = file.file.read(Config.MAX_UPLOAD_BYTES + 1)
    if len(data) > Config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Only PDF documents can be uploaded")
    if doc_type not in DOC_TYPES:
        raise HTTPException(400, f"doc_type must be one of: {', '.join(DOC_TYPES)}")
    try:
        document = rag.ingest(claims["sub"], data, file.filename or "document.pdf", doc_type)
    except ValueError:  # no text layer (e.g. a scanned PDF): OCR for documents is not built yet
        raise HTTPException(422, "No readable text found in this PDF. Scanned documents aren't supported yet.")
    return {"success": True, "document": document}


@router.get("", dependencies=[Depends(rate_limit())])
def list_documents(claims: dict = Depends(current_user), rag: RagService = Depends(get_service)):
    return {"success": True, "documents": rag.store.list_documents(claims["sub"])}


@router.delete("/{doc_id}", dependencies=[Depends(rate_limit())])
def delete_document(doc_id: str, claims: dict = Depends(current_user), rag: RagService = Depends(get_service)):
    if not rag.store.delete_document(claims["sub"], doc_id):
        raise HTTPException(404, "Document not found")
    return {"success": True}


@router.post("/search", dependencies=[Depends(rate_limit("30 per minute"))])
def search(body: Query, claims: dict = Depends(current_user), rag: RagService = Depends(get_service)):
    hits = rag.search(claims["sub"], body.query)
    return {"success": True, "results": [
        {"chunk_id": h.chunk_id, "document_id": h.doc_id, "title": h.title, "section": h.heading,
         "text": h.text, "score": round(h.score, 4)} for h in hits]}


@router.post("/ask", dependencies=[Depends(rate_limit("10 per minute"))])
def ask(body: Question, claims: dict = Depends(current_user), rag: RagService = Depends(get_service)):
    out = rag.ask(claims["sub"], body.question)
    return {"success": True, "answer": out["answer"], "abstained": out["abstained"], "reason": out["reason"],
            "sources": out["sources"]}
