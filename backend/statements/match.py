"""The cross-source matching rule: one real purchase must not be counted twice."""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select

from models import Transaction


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 3}


def is_match(amount: float, day: date, vendor: str, t) -> bool:
    try:
        when = date.fromisoformat(t.date[:10])
    except (TypeError, ValueError):
        return False  # an old row with an unreadable date is never a candidate
    return (t.total_amount is not None and abs(amount - t.total_amount) < 0.01 and abs((day - when).days) <= 3
            and bool(_words(vendor) & _words(t.vendor_name or "")))


def candidates(session, user_id: str, lo: str, hi: str, *, any_source: bool) -> list[Transaction]:
    """The user's rows with lo <= date < hi; any_source=False keeps only invoices (source is NULL)."""
    q = select(Transaction).where(Transaction.user_id == user_id, Transaction.date >= lo, Transaction.date < hi)
    if not any_source:
        q = q.where(Transaction.source.is_(None))
    return list(session.scalars(q))
