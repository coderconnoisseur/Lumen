"""UI revamp Phase 3: GET /api/home/summary, the data behind Home's "Lumen found" card and activity feed.
Rule-based (ai/home_signals.py), no LLM, so it is cheap enough to call on every Home visit."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.budget import _txns
from api.deps import current_user, rate_limit
from api.profile import get_engine

router = APIRouter(prefix="/api/home", tags=["home"])

FOUND_SHOWN = 3


@router.get("/summary", dependencies=[Depends(rate_limit())])
def summary(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    from ai.home_signals import activity, find_signals
    from ai.recurring import find_recurring
    from models import AuditEvent, Proposal, ReviewItem

    user_id, today = claims["sub"], date.today()
    with engine.connect() as conn:
        txns = _txns(conn, user_id)
    with Session(engine) as session:
        review_count = session.scalar(select(func.count()).select_from(ReviewItem).where(
            ReviewItem.user_id == user_id, ReviewItem.status == "flagged")) or 0
        rows = session.execute(
            select(AuditEvent.action, AuditEvent.actor, AuditEvent.created_at, AuditEvent.detail, Proposal.type,
                   Proposal.target)
            .join(Proposal, Proposal.id == AuditEvent.proposal_id, isouter=True)
            .where(AuditEvent.user_id == user_id).order_by(AuditEvent.id.desc()).limit(50)).all()
    events = [dict(r._mapping) for r in rows]
    items = find_signals(txns, today, review_count, find_recurring(txns, today))
    shown = items[:FOUND_SHOWN]
    return {"success": True, "found": shown, "more": max(0, len(items) - FOUND_SHOWN),
            "worth_total": sum(i["worth"] or 0 for i in shown),
            "activity": activity(txns, events, datetime.utcnow())}
