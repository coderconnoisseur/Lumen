"""UI revamp Phase 3: budgets. The overall monthly budget is User.monthly_budget (set in onboarding); per-category
limits live in the budgets table. A draft (ai/budget.py) never writes budgets: it files set_budget proposals that the
user approves one by one through /api/agent/proposals/{id}/approve (api/agent.py applies them)."""
from __future__ import annotations

import json
from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from api.profile import ensure_user, get_engine

router = APIRouter(prefix="/api/budget", tags=["budget"])

_MONTH = "%b"


class CategoryLimit(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    limit: float | None = Field(default=None, gt=0)  # None removes the category's limit


class BudgetUpdate(BaseModel):
    monthly_budget: float | None = Field(default=None, ge=0)
    categories: list[CategoryLimit] = Field(default_factory=list, max_length=50)


def _txns(conn, user_id: str) -> list[dict]:
    # all of one user's rows, filtered in Python: portable across SQLite TEXT and Postgres DATE columns
    return [dict(r) for r in conn.execute(text(
        "SELECT vendor_name, date, total_amount, category, source, created_at FROM transactions WHERE user_id = :u"),
        {"u": user_id}).mappings()]


def _state(engine: Engine, user_id: str, today: date) -> dict:
    from ai.budget import month_spend_by_category
    from models import Budget, User

    with engine.connect() as conn:
        spend = month_spend_by_category(_txns(conn, user_id), today.year, today.month)
    by_key = {k.casefold(): v for k, v in spend.items()}
    with Session(engine) as session:
        user = session.get(User, user_id)
        rows = session.scalars(select(Budget).where(Budget.user_id == user_id)).all()
        cats = [{"category": b.category, "limit": b.monthly_limit, "spent": round(by_key.get(b.category.casefold(), 0), 2)}
                for b in rows]
    cats.sort(key=lambda c: c["spent"] / c["limit"], reverse=True)
    return {"success": True, "month": today.strftime("%Y-%m"), "monthly_budget": user.monthly_budget if user else None,
            "spent": round(sum(spend.values()), 2), "categories": cats}


def upsert_budget(session: Session, user_id: str, category: str, limit: float) -> None:
    """One row per (user, category), matched case-insensitively so 'food' and 'Food' don't become two budgets."""
    from models import Budget

    rows = session.scalars(select(Budget).where(Budget.user_id == user_id)).all()
    row = next((b for b in rows if b.category.casefold() == category.casefold()), None)
    if row is None:
        session.add(Budget(user_id=user_id, category=category, monthly_limit=limit))
    else:
        row.monthly_limit, row.updated_at = limit, datetime.utcnow()


def create_draft(engine: Engine, user_id: str, today: date) -> list[dict]:
    """File one pending set_budget proposal per drafted line, after retiring the user's still-pending ones."""
    from ai.budget import draft_budget
    from api.agent import _proposal_dict
    from models import AuditEvent, Proposal

    with engine.connect() as conn:
        lines = draft_budget(_txns(conn, user_id), today)
    with Session(engine) as session, session.begin():
        for old in session.scalars(select(Proposal).where(Proposal.user_id == user_id, Proposal.type == "set_budget",
                                                          Proposal.status == "pending")).all():
            old.status, old.decided_at = "rejected", datetime.utcnow()
            session.add(AuditEvent(user_id=user_id, actor="agent", action="proposal_rejected", proposal_id=old.id,
                                   detail=json.dumps({"superseded": True})))
        out = []
        for line in lines:
            months = line["basis"]["months"]
            span = f"{date.fromisoformat(months[0] + '-01'):{_MONTH}}–{date.fromisoformat(months[-1] + '-01'):{_MONTH}}"
            p = Proposal(user_id=user_id, type="set_budget", target=line["category"], risk="low",
                         payload=json.dumps({"limit": line["limit"], "basis": line["basis"]}),
                         reason=f"Averaged {line['basis']['average']:,.0f} a month over {span}, rounded up.",
                         evidence="[]", status="pending")
            session.add(p)
            session.flush()
            session.add(AuditEvent(user_id=user_id, actor="agent", action="proposal_created", proposal_id=p.id,
                                   detail=json.dumps({"type": "set_budget", "target": p.target, "risk": "low"})))
            out.append(_proposal_dict(p))
        return out


@router.get("", dependencies=[Depends(rate_limit())])
def get_budget(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    return _state(engine, claims["sub"], date.today())


@router.put("", dependencies=[Depends(rate_limit())])
def put_budget(body: BudgetUpdate, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    from models import Budget

    user_id = claims["sub"]
    with Session(engine) as session, session.begin():
        if "monthly_budget" in body.model_fields_set:
            ensure_user(session, user_id, claims.get("email")).monthly_budget = body.monthly_budget
        for c in body.categories:
            name = c.category.strip()
            if c.limit is None:
                for b in session.scalars(select(Budget).where(Budget.user_id == user_id)).all():
                    if b.category.casefold() == name.casefold():
                        session.delete(b)
            else:
                upsert_budget(session, user_id, name, c.limit)
    return _state(engine, user_id, date.today())


@router.post("/draft", dependencies=[Depends(rate_limit("10 per minute"))])
def draft(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    return {"success": True, "proposals": create_draft(engine, claims["sub"], date.today())}
