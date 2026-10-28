"""Forecast F2 (spec docs/superpowers/specs/2026-10-28-forecast-design.md §3.6): this month and the next three for the
signed-in user, from `ai/forecast.py` over their own transactions, saved recurring states, budgets and income. Home,
Budget, Ask Lumen and the Forecast page all read this one forecast."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from api.profile import get_engine

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


def _budgets(session: Session, user, user_id: str, months: list[str]) -> dict[str, dict]:
    from api.budget import _rows, limits_in_force, this_month

    rows, now = _rows(session, user_id), this_month()
    out = {}
    for m in months:
        limits = limits_in_force(rows, m)
        overall = user.monthly_budget if user and (limits or m >= now) else None
        total = overall or (round(sum(v for _, v in limits.values()), 2) if limits else None)
        out[m] = {"total": total, "categories": {name: limit for name, limit in limits.values()}}
    return out


def forecast_for_user(engine: Engine, user_id: str, today: date) -> dict | None:
    """The forecast for one user as of `today` (their own calendar day), or None with too little history."""
    from ai.forecast import HORIZON, _next, forecast
    from api.bills import _recurring
    from models import User

    with engine.connect() as conn:
        txns = [dict(r) for r in conn.execute(text(
            "SELECT vendor_name, date, total_amount, category FROM transactions WHERE user_id = :u"), {"u": user_id}).mappings()]
    recurring = _recurring(engine, user_id, today)["items"]  # saved states applied; "not a bill" vendors left out
    months = ["%d-%02d" % _next(today.year, today.month, i) for i in range(HORIZON)]
    with Session(engine) as session:
        user = session.get(User, user_id)
        budgets = _budgets(session, user, user_id, months)
        income, currency = (user.monthly_income, user.currency) if user else (None, None)
    return forecast(txns, recurring, today, budgets=budgets, income=income, currency=currency)


@router.get("", dependencies=[Depends(rate_limit())])
def get_forecast(today: str | None = Query(default=None), claims: dict = Depends(current_user),
                 engine: Engine = Depends(get_engine)):
    """`today` is the browser's date, so the 1st of the month in India isn't read as last month on the UTC server;
    it must be within a day of the server's date."""
    server = date.today()
    if today is None:
        day = server
    else:
        try:
            day = date.fromisoformat(today)
        except ValueError:
            raise HTTPException(422, "today must be a date (YYYY-MM-DD).")
        if abs((day - server).days) > 1:
            raise HTTPException(422, "today must be within a day of the server's date.")
    return {"success": True, "forecast": forecast_for_user(engine, claims["sub"], day)}
