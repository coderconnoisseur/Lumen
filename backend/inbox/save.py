"""SPEC-EMAIL-INGEST: turn a parsed money email into a transaction, once. The caller commits."""
from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import select

from api.profile import ensure_user
from inbox.parse import ParsedEmail
from models import ProcessedEmail, Transaction
from statements import match, vendor


def already_processed(session, user_id: str, message_id: str) -> bool:
    return session.scalar(select(ProcessedEmail.id).where(
        ProcessedEmail.user_id == user_id, ProcessedEmail.message_id == message_id)) is not None


def mark_processed(session, user_id: str, message_id: str) -> None:
    if not already_processed(session, user_id, message_id):
        session.add(ProcessedEmail(user_id=user_id, message_id=message_id))
        session.flush()


def save_email_transaction(session, user_id: str, parsed: ParsedEmail, message_id: str, *,
                           default_currency: str) -> Literal["imported", "credit", "duplicate", "matched", "not_transaction"]:
    if not parsed.is_transaction:
        return "not_transaction"
    if parsed.direction == "credit":
        return "credit"
    if parsed.direction != "debit" or not parsed.amount:
        return "not_transaction"  # unknown direction or no amount is not a spend we can book

    key = hashlib.sha1(f"{user_id}|{message_id}".encode()).hexdigest()
    if session.scalar(select(Transaction.id).where(Transaction.user_id == user_id, Transaction.import_key == key)):
        return "duplicate"

    try:
        day = date.fromisoformat((parsed.date or "")[:10])
    except ValueError:
        day = date.today()  # ponytail: an email with no readable date is booked as received today
    name = vendor.clean(parsed.merchant or "")
    lo, hi = (day - timedelta(days=3)).isoformat(), (day + timedelta(days=4)).isoformat()
    if any(match.is_match(parsed.amount, day, name, t)
           for t in match.candidates(session, user_id, lo, hi, any_source=True)):
        return "matched"

    ensure_user(session, user_id, None)
    session.add(Transaction(
        user_id=user_id, vendor_name=name, date=day.isoformat(), total_amount=parsed.amount,
        category="Subscriptions" if parsed.kind == "subscription" else vendor.category(name),
        currency=parsed.currency or default_currency, source="email", import_key=key))
    session.flush()
    return "imported"
