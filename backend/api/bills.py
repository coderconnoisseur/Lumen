"""UI revamp Phase 5c: recurring charges for the Bills page and Home's "Coming up".

Detection is ai/recurring.find_recurring over the user's transactions (pure, no LLM). The user's choices live in
recurring_states: "not_a_bill" moves a vendor to `hidden`, "cancelled" keeps it listed as cancelled unless it was
charged again after the cancel ("charged_again"). Posting "active" forgets the choice.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from ai.recurring import _norm, find_recurring
from api.deps import current_user, rate_limit
from api.profile import get_engine

router = APIRouter(prefix="/api/bills", tags=["bills"])


class StateChange(BaseModel):
    vendor: str = Field(min_length=1, max_length=200)
    state: Literal["cancelled", "not_a_bill", "active"]


def _recurring(engine: Engine, user_id: str, today: date) -> dict:
    from models import RecurringState

    with engine.connect() as conn:
        rows = [dict(r) for r in conn.execute(text(
            "SELECT vendor_name, date, total_amount, category FROM transactions WHERE user_id = :u"), {"u": user_id}).mappings()]
    with Session(engine) as session:
        states = {s.vendor_key: s for s in session.scalars(select(RecurringState).where(RecurringState.user_id == user_id))}
    items, hidden = [], []
    for item in find_recurring(rows, today):
        key = _norm(item["vendor"])
        saved = states.get(key)
        if saved and saved.state == "not_a_bill":
            hidden.append({"vendor": item["vendor"], "vendor_key": key})
            continue
        state = "active"
        if saved and saved.state == "cancelled":
            state = "charged_again" if item["last_charge_date"] > saved.changed_at.date().isoformat() else "cancelled"
        items.append({**item, "state": state})
    return {"success": True, "items": items, "hidden": hidden}


@router.get("/recurring", dependencies=[Depends(rate_limit())])
def recurring(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    return _recurring(engine, claims["sub"], date.today())


@router.post("/recurring/state", dependencies=[Depends(rate_limit())])
def set_state(body: StateChange, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    from models import RecurringState

    user_id, key = claims["sub"], _norm(body.vendor)
    with Session(engine) as session, session.begin():
        row = session.scalars(select(RecurringState).where(RecurringState.user_id == user_id,
                                                           RecurringState.vendor_key == key)).first()
        if body.state == "active":
            if row:
                session.delete(row)
        elif row:
            row.state, row.changed_at = body.state, datetime.utcnow()
        else:
            session.add(RecurringState(user_id=user_id, vendor_key=key, state=body.state))
    return _recurring(engine, user_id, date.today())
