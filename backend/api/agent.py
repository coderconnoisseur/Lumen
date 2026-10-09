"""Agent API (SPEC-AGENT): ask the agent, and let a human approve or reject what it proposes.

The agent itself never changes data. Approval is this separate, authenticated call, and every decision is written
to the audit log. Of the proposal types, only `update_category` has data to change today (the invoice's category);
the others are recorded decisions until the review queue lands (SPEC-EXTRACT).
"""
from __future__ import annotations

import json
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


DEMO_QUESTIONS_PER_DAY = 20  # all visitors share one free Groq quota (~1K requests/day; SPEC-DEPLOY)


def count_demo_question(claims: dict, authorization: str, client: str) -> bool:
    """One daily allowance per demo (anonymous) account, shared by /chat and /api/agent/ask. False = used up."""
    from limits import parse

    from utils.limiter import limiter, rate_limit_key

    if not claims.get("is_anonymous") or not limiter.enabled:
        return True
    return limiter.limiter.hit(parse(f"{DEMO_QUESTIONS_PER_DAY} per day"), rate_limit_key(authorization, client),
                               "demo-questions")


def demo_quota(request: Request, claims: dict = Depends(current_user)) -> None:
    """Anonymous demo visitors get a daily question cap; signed-up accounts don't."""
    if not count_demo_question(claims, request.headers.get("Authorization", ""),
                               request.client.host if request.client else "127.0.0.1"):
        raise HTTPException(429, f"The demo allows {DEMO_QUESTIONS_PER_DAY} questions a day. Sign up to keep going.")


@router.post("/ask", dependencies=[Depends(rate_limit("10 per minute")), Depends(demo_quota)])
def ask(body: Question, claims: dict = Depends(current_user), deps: AgentDeps = Depends(get_agent_deps)):
    from agent.graph import run_agent
    from agent.tools import ToolContext

    ctx = ToolContext(user_id=claims["sub"], engine=deps.engine, sql_agent=deps.sql_agent, rag=deps.rag,
                      today=deps.today or date.today())
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


def _decide(proposal_id: str, user_id: str, decision: str, deps: AgentDeps) -> dict:
    from models import AuditEvent, Proposal, Transaction

    with Session(deps.engine) as session, session.begin():
        p = session.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.user_id == user_id))
        if p is None:
            raise HTTPException(404, "Proposal not found")
        if p.status != "pending":
            raise HTTPException(409, f"Proposal is already {p.status}")
        applied = None
        if decision == "approved" and p.type == "update_category":
            category = json.loads(p.payload or "{}").get("category")
            if category:
                result = session.execute(update(Transaction).where(
                    Transaction.user_id == user_id, Transaction.invoice_number == p.target).values(category=category))
                applied = {"category": category, "transactions_updated": result.rowcount}
        p.status, p.decided_at = decision, datetime.utcnow()
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
