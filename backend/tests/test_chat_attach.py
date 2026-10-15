"""Ask Lumen: attach an invoice, see its checks, save it with one approval. Scripted model and reader, no LLM calls."""
import io
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from llm.client import LLMResult

INVOICE = {"vendor_name": "Acme Paper", "invoice_number": "AP-1001", "date": "2026-10-01", "currency": "INR",
           "subtotal": 1000.0, "tax_amount": 180.0, "total_amount": 1180.0, "items": [
               {"item_name": "A4 paper", "quantity": 10, "unit_price": 100.0, "total_price": 1000.0}]}
EMPTY = {**INVOICE, "vendor_name": None, "total_amount": None}


def _png() -> io.BytesIO:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1, 1)).save(buf, format="PNG")
    buf.seek(0)
    return buf


@pytest.fixture
def env(authed_client, tmp_path, monkeypatch):
    import routes.chat as chat
    import routes.ocr as ocr
    from api import agent as agent_api
    from models.database import db

    engine = create_engine(f"sqlite:///{tmp_path / 'c.db'}")
    db.metadata.create_all(engine)
    seen = []

    def complete(messages, **kwargs):
        seen.append(messages)
        return LLMResult(text="Looks fair.", tool_calls=None, provider="fake", model="fake")

    deps = agent_api.AgentDeps(engine=engine, sql_agent=None, complete=complete)
    monkeypatch.setattr(agent_api, "get_agent_deps", lambda: deps)
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: None)
    monkeypatch.setattr(ocr, "keep", lambda key, data: key)
    monkeypatch.setattr(ocr, "read_with_feedback", lambda *a, **k: dict(INVOICE))

    def post(file=True, query="Is this a fair price?"):
        data = {"query": query}
        if file:
            data["file"] = (_png(), "inv.png")
        return authed_client.post("/chat", data=data, content_type="multipart/form-data",
                                  headers={"Authorization": "Bearer x.y.z"})

    return post, engine, deps, seen


def _count(engine, model):
    with Session(engine) as s:
        return s.scalar(select(func.count()).select_from(model))


def test_chat_with_attachment_returns_card_and_files_proposal(env):
    from models import Proposal, Transaction

    post, engine, _, seen = env
    resp = post()
    att = resp.get_json()["data"]["attachment"]
    assert resp.status_code == 200 and att["invoice"]["vendor_name"] == "Acme Paper" and att["proposal_id"]
    with Session(engine) as s:
        p = s.scalar(select(Proposal).where(Proposal.user_id == "user-1"))
    assert (p.type, p.status, p.id) == ("save_invoice", "pending", att["proposal_id"])
    assert _count(engine, Transaction) == 0
    assert any("Acme Paper" in m["content"] for m in seen[0] if m["role"] == "user")


def test_approve_save_invoice_records_once(env):
    from api.agent import _decide
    from models import ReviewItem, Transaction

    post, engine, deps, _ = env
    pid = post().get_json()["data"]["attachment"]["proposal_id"]
    out = _decide(pid, "user-1", "approved", deps)
    assert out["proposal"]["status"] == "approved"
    with pytest.raises(HTTPException) as e:
        _decide(pid, "user-1", "approved", deps)
    assert e.value.status_code == 409
    assert _count(engine, ReviewItem) == 1  # one submission (auto-approved: its transaction, else queued for review)
    assert _count(engine, Transaction) == 1


def test_other_user_cannot_approve(env):
    from api.agent import _decide

    post, _, deps, _ = env
    pid = post().get_json()["data"]["attachment"]["proposal_id"]
    with pytest.raises(HTTPException) as e:
        _decide(pid, "someone-else", "approved", deps)
    assert e.value.status_code == 404


def test_attachment_without_invoice_data_still_answers(env, monkeypatch):
    import routes.ocr as ocr
    from models import Proposal

    post, engine, _, _ = env
    monkeypatch.setattr(ocr, "read_with_feedback", lambda *a, **k: dict(EMPTY))
    resp = post()
    assert resp.status_code == 200 and resp.get_json()["data"]["attachment"]["code"] == "no_invoice_data"
    assert _count(engine, Proposal) == 0


def test_attachment_llm_outage_is_friendly_error(env, monkeypatch):
    import routes.ocr as ocr
    from models import Proposal, Transaction
    from utils.llm import LLMError

    def down(*a, **k):
        raise LLMError(LLMError.UNAVAILABLE, "down")

    post, engine, _, _ = env
    monkeypatch.setattr(ocr, "read_with_feedback", down)
    resp = post()
    assert resp.status_code == 503 and resp.get_json()["code"] == "llm_unavailable"
    assert _count(engine, Proposal) == 0 and _count(engine, Transaction) == 0


def test_json_chat_unchanged(env, authed_client):
    resp = authed_client.post("/chat", json={"query": "hi"}, headers={"Authorization": "Bearer x.y.z"})
    assert resp.status_code == 200 and resp.get_json()["data"]["attachment"] is None
