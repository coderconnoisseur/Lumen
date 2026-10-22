"""Agent API (SPEC-AGENT): ask the agent, and let a human approve or reject what it proposes.

The agent itself never changes data. Approval is this separate, authenticated call, and every decision is written
to the audit log. Of the proposal types, only `update_category` has data to change today (the invoice's category);
the others are recorded decisions until the review queue lands (SPEC-EXTRACT).
"""
from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from llm import keys
from llm.errors import LLMError

router = APIRouter(prefix="/api/agent", tags=["agent"])


@dataclass
class AgentDeps:
    engine: Engine
    sql_agent: Any
    rag: Any = None
    complete: Callable[..., Any] | None = None  # None = llm.client.complete
    today: date | None = None  # None = the real date


_lock = threading.Lock()
_deps: AgentDeps | None = None


def get_agent_deps() -> AgentDeps:
    """One SQL agent and engine per process; document search shares the RAG service's models."""
    global _deps
    with _lock:
        if _deps is None:
            from ai.sql_agent import SQLAgent
            from rag.service import get_service

            rag = get_service()
            _deps = AgentDeps(engine=rag.store.engine, sql_agent=SQLAgent(), rag=rag)
        return _deps


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


def count_platform_question(claims: dict, authorization: str, client: str) -> bool:
    """Daily free allowance on the platform key for any user without their own agent key (demo or signed up),
    shared by /chat and /api/agent/ask. Needs the `keys.for_user` context. False = used up."""
    from limits import parse

    from config import Config
    from utils.limiter import limiter, rate_limit_key

    if not limiter.enabled or keys.has_key("agent"):
        return True
    return limiter.limiter.hit(parse(f"{Config.PLATFORM_QUESTIONS_PER_DAY} per day"),
                               rate_limit_key(authorization, client), "platform-questions")


@router.post("/ask", dependencies=[Depends(rate_limit("10 per minute"))])
def ask(body: Question, request: Request, claims: dict = Depends(current_user), deps: AgentDeps = Depends(get_agent_deps)):
    from agent.graph import run_agent
    from agent.tools import ToolContext
    from api.profile import profile_for

    ctx = ToolContext(user_id=claims["sub"], engine=deps.engine, sql_agent=deps.sql_agent, rag=deps.rag,
                      today=deps.today or date.today(), profile=profile_for(deps.engine, claims["sub"]),
                      question=body.question)
    with keys.for_user(claims["sub"], deps.engine):
        if not count_platform_question(claims, request.headers.get("Authorization", ""),
                                       request.client.host if request.client else "127.0.0.1"):
            raise LLMError(LLMError.NEEDS_KEY, "free question allowance used")  # 402 needs_key (api/errors.py)
        out = run_agent(body.question, ctx, complete=deps.complete)
    return {"success": True, **out}


def _proposal_dict(p) -> dict:
    return {"id": p.id, "type": p.type, "target": p.target, "risk": p.risk, "reason": p.reason,
            "payload": json.loads(p.payload or "{}"), "evidence": json.loads(p.evidence or "[]"), "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "decided_at": p.decided_at.isoformat() if p.decided_at else None}


@router.get("/proposals", dependencies=[Depends(rate_limit())])
def list_proposals(status: Literal["pending", "approved", "rejected"] | None = None,
                   claims: dict = Depends(current_user), deps: AgentDeps = Depends(get_agent_deps)):
    from models import Proposal

    with Session(deps.engine) as session:
        query = select(Proposal).where(Proposal.user_id == claims["sub"])
        if status:
            query = query.where(Proposal.status == status)
        rows = session.scalars(query.order_by(Proposal.created_at.desc())).all()
        return {"success": True, "proposals": [_proposal_dict(p) for p in rows]}


def _save_invoice(proposal_id: str, user_id: str, deps: AgentDeps) -> dict | None:
    """Approve a save_invoice proposal: claim it atomically (a double approve can't save twice), then run
    submit_invoice outside the claim. None = not a save_invoice (the normal path handles it)."""
    from api.review import submit_invoice
    from models import AuditEvent, Proposal

    with Session(deps.engine) as session, session.begin():
        p = session.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.user_id == user_id))
        if p is None or p.type != "save_invoice":
            return None
        if not session.execute(update(Proposal).where(
                Proposal.id == proposal_id, Proposal.user_id == user_id, Proposal.status == "pending")
                .values(status="saving")).rowcount:
            raise HTTPException(409, "This proposal was already decided.")
        payload = json.loads(p.payload or "{}")
    try:
        item = submit_invoice(deps.engine, user_id, payload, warnings_seen=True)
    except Exception:
        with Session(deps.engine) as session, session.begin():
            session.execute(update(Proposal).where(Proposal.id == proposal_id).values(status="pending"))
        raise
    applied = {"review_item": item["id"], "status": item["status"], "transaction_id": item.get("transaction_id")}
    with Session(deps.engine) as session, session.begin():
        p = session.get(Proposal, proposal_id)
        p.status, p.decided_at = "approved", datetime.utcnow()
        session.add(AuditEvent(user_id=user_id, actor="user", action="proposal_approved", proposal_id=p.id,
                               detail=json.dumps({"applied": applied})))
        session.flush()
        return {"success": True, "proposal": _proposal_dict(p), "applied": applied}


def _decide(proposal_id: str, user_id: str, decision: str, deps: AgentDeps) -> dict:
    from models import AuditEvent, Proposal, Transaction

    if decision == "approved" and (saved := _save_invoice(proposal_id, user_id, deps)):
        return saved
    with Session(deps.engine) as session, session.begin():
        p = session.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.user_id == user_id))
        if p is None:
            raise HTTPException(404, "Proposal not found")
        # claim it first (UPDATE ... WHERE status = 'pending'): of two concurrent decisions only one can apply;
        # anything raised below rolls the claim back with the rest of the transaction. The 409 doesn't name p.status:
        # it was read before the claim, so the loser of a race would still see "pending"
        now = datetime.utcnow()
        if not session.execute(update(Proposal).where(
                Proposal.id == proposal_id, Proposal.user_id == user_id, Proposal.status == "pending")
                .values(status=decision, decided_at=now).execution_options(synchronize_session=False)).rowcount:
            raise HTTPException(409, "This proposal was already decided.")
        p.status, p.decided_at = decision, now
        applied = None
        if decision == "approved" and p.type == "set_budget":
            from api.budget import this_month, upsert_budget, valid_month

            # the agent can file set_budget with any payload: only a real positive limit is ever applied
            try:
                payload = json.loads(p.payload or "{}")
                limit = float(payload["limit"])
            except (KeyError, TypeError, ValueError):
                payload, limit = {}, math.nan
            if not math.isfinite(limit) or limit <= 0 or not p.target.strip():
                raise HTTPException(422, "This budget suggestion has no valid limit; reject it instead.")
            # from the month the draft was for, but never earlier than this one: past months stay as they were
            upsert_budget(session, user_id, p.target.strip(), limit, max(valid_month(payload.get("month")) or "", this_month()))
            applied = {"category": p.target.strip(), "limit": limit}
        if decision == "approved" and p.type == "update_category":
            category = json.loads(p.payload or "{}").get("category")
            if category:
                result = session.execute(update(Transaction).where(
                    Transaction.user_id == user_id, Transaction.invoice_number == p.target).values(category=category))
                applied = {"category": category, "transactions_updated": result.rowcount}
        session.add(AuditEvent(user_id=user_id, actor="user", action=f"proposal_{decision}", proposal_id=p.id,
                               detail=json.dumps({"applied": applied})))
        session.flush()
        return {"success": True, "proposal": _proposal_dict(p), "applied": applied}


@router.post("/proposals/{proposal_id}/approve", dependencies=[Depends(rate_limit())])
def approve(proposal_id: str, claims: dict = Depends(current_user), deps: AgentDeps = Depends(get_agent_deps)):
    return _decide(proposal_id, claims["sub"], "approved", deps)


@router.post("/proposals/{proposal_id}/reject", dependencies=[Depends(rate_limit())])
def reject(proposal_id: str, claims: dict = Depends(current_user), deps: AgentDeps = Depends(get_agent_deps)):
    return _decide(proposal_id, claims["sub"], "rejected", deps)
