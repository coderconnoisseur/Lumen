"""UI revamp Phase 3: budgets. The overall monthly budget is User.monthly_budget (set in onboarding); per-category
limits live in the budgets table. A draft (ai/budget.py) never writes budgets: it files set_budget proposals that the
user approves one by one through /api/agent/proposals/{id}/approve (api/agent.py applies them).
Phase 5d: limits are versioned by month (models.Budget); every read is for one month, every write is from one month on."""
from __future__ import annotations

import json
import re
from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from api.profile import ensure_user, get_engine

router = APIRouter(prefix="/api/budget", tags=["budget"])

_MONTH = "%b"
MONTH_RE = r"^\d{4}-(0[1-9]|1[0-2])$"


def this_month(today: date | None = None) -> str:
    return (today or date.today()).strftime("%Y-%m")


def valid_month(value) -> str | None:
    return value if isinstance(value, str) and re.match(MONTH_RE, value) else None


def _shift(month: str, n: int) -> str:
    y, m = divmod(int(month[:4]) * 12 + int(month[5:]) - 1 + n, 12)
    return f"{y}-{m + 1:02d}"


def near_month(month: str | None) -> str:
    """`month` if it's the server's month or next to it, else 422; None means the server's month."""
    from fastapi import HTTPException

    now = this_month()
    if month is None or month == now:
        return now
    if month in (_shift(now, -1), _shift(now, 1)):
        return month
    raise HTTPException(422, "Budgets can only be changed for the current month.")


def limits_in_force(rows, month: str) -> dict[str, tuple[str, float]]:
    """Case-folded category -> (name, limit) for `month`: each category's latest row from that month or before.
    A limit of 0 is a removal, so the category has none."""
    latest: dict[str, object] = {}
    for b in sorted(rows, key=lambda b: b.effective_from or ""):
        if (b.effective_from or "") <= month:
            latest[b.category.casefold()] = b
    return {k: (b.category, b.monthly_limit) for k, b in latest.items() if b.monthly_limit > 0}


class CategoryLimit(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    limit: float | None = Field(default=None, gt=0)  # None removes the category's limit


class BudgetUpdate(BaseModel):
    monthly_budget: float | None = Field(default=None, ge=0)
    # the browser's month: around midnight on the 1st it can be a month off the server's (UTC) date
    month: str | None = Field(default=None, pattern=MONTH_RE)
    categories: list[CategoryLimit] = Field(default_factory=list, max_length=50)


def _txns(conn, user_id: str) -> list[dict]:
    # all of one user's rows, filtered in Python: portable across SQLite TEXT and Postgres DATE columns
    return [dict(r) for r in conn.execute(text(
        "SELECT vendor_name, date, total_amount, category, source, created_at FROM transactions WHERE user_id = :u"),
        {"u": user_id}).mappings()]


def _spend(engine: Engine, user_id: str, month: str) -> dict[str, float]:
    from ai.budget import month_spend_by_category

    with engine.connect() as conn:
        return month_spend_by_category(_txns(conn, user_id), int(month[:4]), int(month[5:]))


def _rows(session: Session, user_id: str) -> list:
    from models import Budget

    return session.scalars(select(Budget).where(Budget.user_id == user_id)).all()


def _state(engine: Engine, user_id: str, month: str) -> dict:
    from models import User

    spend = _spend(engine, user_id, month)
    by_key = {k.casefold(): v for k, v in spend.items()}
    with Session(engine) as session:
        user = session.get(User, user_id)
        limits = limits_in_force(_rows(session, user_id), month)
        cats = [{"category": name, "limit": limit, "spent": round(by_key.get(key, 0), 2)}
                for key, (name, limit) in limits.items()]
    cats.sort(key=lambda c: c["spent"] / c["limit"], reverse=True)
    # the overall budget isn't versioned, so a past month only has it once category limits were in force
    overall = user.monthly_budget if user and (limits or month >= this_month()) else None
    return {"success": True, "month": month, "monthly_budget": overall,
            "spent": round(sum(spend.values()), 2), "categories": cats}


def upsert_budget(session: Session, user_id: str, category: str, limit: float, month: str) -> None:
    """Sets `category`'s limit from `month` on (0 removes it). One row per (user, category, month), matched
    case-insensitively so 'food' and 'Food' don't become two budgets."""
    from models import Budget

    row = next((b for b in _rows(session, user_id)
                if b.category.casefold() == category.casefold() and b.effective_from == month), None)
    if row is None:
        session.add(Budget(user_id=user_id, category=category, monthly_limit=limit, effective_from=month))
    else:
        row.monthly_limit, row.updated_at = limit, datetime.utcnow()


def create_draft(engine: Engine, user_id: str, today: date) -> list[dict]:
    """File one pending set_budget proposal per drafted line, after retiring the user's still-pending ones."""
    from ai.budget import draft_budget
    from api.agent import _proposal_dict
    from models import AuditEvent, Proposal, User
    from utils.money import fmt

    with engine.connect() as conn:
        lines = draft_budget(_txns(conn, user_id), today)
    with Session(engine) as session, session.begin():
        user = session.get(User, user_id)
        currency = user.currency if user else None
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
                         payload=json.dumps({"limit": line["limit"], "basis": line["basis"], "month": this_month(today)}),
                         reason=f"Averaged {fmt(line['basis']['average'], currency)} a month over {span}, rounded up.",
                         evidence="[]", status="pending")
            session.add(p)
            session.flush()
            session.add(AuditEvent(user_id=user_id, actor="agent", action="proposal_created", proposal_id=p.id,
                                   detail=json.dumps({"type": "set_budget", "target": p.target, "risk": "low"})))
            out.append(_proposal_dict(p))
        return out


@router.get("", dependencies=[Depends(rate_limit())])
def get_budget(month: str | None = Query(default=None, pattern=MONTH_RE), claims: dict = Depends(current_user),
               engine: Engine = Depends(get_engine)):
    return _state(engine, claims["sub"], month or this_month())


@router.get("/history", dependencies=[Depends(rate_limit())])
def get_history(months: int = Query(default=6, ge=1, le=12), to: str | None = Query(default=None, pattern=MONTH_RE),
                claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    """Budget vs spent for the last `months` months, oldest first, ending with this one. A past month with no
    category limit in force has no budget (null): spend only."""
    from models import User

    user_id, now = claims["sub"], near_month(to)
    with Session(engine) as session:
        user = session.get(User, user_id)
        overall = user.monthly_budget if user else None
        rows = _rows(session, user_id)
    from ai.budget import month_spend_by_category

    with engine.connect() as conn:
        txns = _txns(conn, user_id)
    out = []
    for month in (_shift(now, -n) for n in range(months - 1, -1, -1)):
        limits = limits_in_force(rows, month)
        budget = (overall or round(sum(v for _, v in limits.values()), 2) or None) if limits or month >= now else None
        spent = sum(month_spend_by_category(txns, int(month[:4]), int(month[5:])).values())
        out.append({"month": month, "budget": budget, "spent": round(spent, 2)})
    return {"success": True, "months": out}


@router.put("", dependencies=[Depends(rate_limit())])
def put_budget(body: BudgetUpdate, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    """Changes apply from the current month on; past months keep the limits they had."""
    user_id, month = claims["sub"], near_month(body.month)
    with Session(engine) as session, session.begin():
        if "monthly_budget" in body.model_fields_set:
            ensure_user(session, user_id, claims.get("email")).monthly_budget = body.monthly_budget
        for c in body.categories:
            upsert_budget(session, user_id, c.category.strip(), c.limit or 0, month)
    return _state(engine, user_id, month)


@router.post("/draft", dependencies=[Depends(rate_limit("10 per minute"))])
def draft(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    return {"success": True, "proposals": create_draft(engine, claims["sub"], date.today())}
