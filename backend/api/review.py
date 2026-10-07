"""Review queue (SPEC-EXTRACT, EXT-03): every extracted invoice is checked (`extract/validate.py`).

High confidence (no flags) becomes a transaction at once; anything else waits as `flagged` until a person approves
(optionally with edits, which are checked again) or rejects it. Only approved invoices become transactions, the
status change and the transaction are written together, and every step goes to the audit log.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from extract.validate import Context, confidence, validate

router = APIRouter(prefix="/api/review", tags=["review"])


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    from config import Config

    return create_engine(Config.DATABASE_URI, pool_pre_ping=True)


def today() -> date:
    return date.today()


class Submit(BaseModel):
    invoice: dict


class Decision(BaseModel):
    edits: dict = {}
    note: str | None = None


def _context(session: Session, user_id: str) -> Context:
    from models import PurchaseOrder, Transaction

    txns = session.execute(select(Transaction.vendor_name, Transaction.invoice_number)
                           .where(Transaction.user_id == user_id)).all()
    pos = session.scalars(select(PurchaseOrder).where(PurchaseOrder.user_id == user_id)).all()
    return Context(today=today(), known_vendors={v for v, _ in txns if v},
                   seen_invoices={(v.lower(), n) for v, n in txns if v and n},
                   purchase_orders={p.po_number: {"vendor_name": p.vendor_name, "lines": json.loads(p.lines)} for p in pos})


def _item_dict(item) -> dict:
    return {"id": item.id, "status": item.status, "confidence": item.confidence, "invoice": json.loads(item.invoice),
            "flags": json.loads(item.flags), "transaction_id": item.transaction_id, "note": item.note,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "decided_at": item.decided_at.isoformat() if item.decided_at else None}


def _check(session: Session, item, user_id: str) -> None:
    flags = validate(json.loads(item.invoice), _context(session, user_id))
    item.flags = json.dumps([f.__dict__ for f in flags])
    item.confidence = confidence(flags)


def _record(session: Session, user_id: str, inv: dict) -> str:
    """The approved invoice as a transaction (same fields as the upload path's save_transaction)."""
    from models import Transaction, TransactionItem, User

    if session.get(User, user_id) is None:
        session.add(User(id=user_id, email=f"{user_id}@users.lumen.local"))
    tx = Transaction(id=str(uuid.uuid4()), user_id=user_id, vendor_name=inv["vendor_name"],
                     invoice_number=inv["invoice_number"], date=inv["date"], total_amount=inv["total_amount"],
                     tax_amount=inv.get("tax_amount"), payment_method=inv.get("payment_method"),
                     address=inv.get("address"), category=inv.get("category"))
    session.add(tx)
    for i in inv.get("items") or []:
        session.add(TransactionItem(id=str(uuid.uuid4()), transaction_id=tx.id, item_name=i["item_name"],
                                    quantity=i.get("quantity"), unit_price=i.get("unit_price"),
                                    total_price=i.get("total_price")))
    return tx.id


def _audit(session: Session, user_id: str, actor: str, action: str, item, **detail) -> None:
    from models import AuditEvent

    session.add(AuditEvent(user_id=user_id, actor=actor, action=action,
                           detail=json.dumps({"review_item_id": item.id, **detail})))


@router.post("", dependencies=[Depends(rate_limit())])
def submit(body: Submit, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    """Check an extracted invoice; approve it at once if nothing is doubtful, otherwise queue it."""
    from models import ReviewItem

    user_id = claims["sub"]
    with Session(engine) as session, session.begin():
        item = ReviewItem(id=str(uuid.uuid4()), user_id=user_id, invoice=json.dumps(body.invoice), status="flagged")
        _check(session, item, user_id)
        if item.confidence == "high":
            item.status, item.decided_at = "approved", datetime.utcnow()
            item.transaction_id = _record(session, user_id, body.invoice)
            _audit(session, user_id, "system", "review_auto_approved", item, transaction_id=item.transaction_id)
        else:
            _audit(session, user_id, "system", "review_flagged", item, flags=json.loads(item.flags))
        session.add(item)
        session.flush()
        return {"success": True, "item": _item_dict(item)}


@router.get("", dependencies=[Depends(rate_limit())])
def list_items(status: str = "flagged", claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    from models import ReviewItem

    with Session(engine) as session:
        rows = session.scalars(select(ReviewItem).where(ReviewItem.user_id == claims["sub"], ReviewItem.status == status)
                               .order_by(ReviewItem.created_at.desc())).all()
        return {"success": True, "items": [_item_dict(r) for r in rows]}


def _decide(item_id: str, user_id: str, decision: str, body: Decision, engine: Engine) -> dict:
    from models import ReviewItem

    try:
        with Session(engine) as session, session.begin():
            item = session.scalar(select(ReviewItem).where(ReviewItem.id == item_id, ReviewItem.user_id == user_id))
            if item is None:
                raise HTTPException(404, "Review item not found")
            if item.status != "flagged":
                raise HTTPException(409, f"Already {item.status}")
            if body.edits:
                item.invoice = json.dumps({**json.loads(item.invoice), **body.edits})
                _check(session, item, user_id)  # flags now describe what is actually approved
            item.status, item.decided_at, item.note = decision, datetime.utcnow(), body.note
            if decision == "approved":
                item.transaction_id = _record(session, user_id, json.loads(item.invoice))
            _audit(session, user_id, "user", f"review_{decision}", item, edits=body.edits, note=body.note,
                   remaining_flags=json.loads(item.flags))
            session.flush()
            return {"success": True, "item": _item_dict(item)}
    except IntegrityError:
        raise HTTPException(409, "This invoice is already recorded")


@router.post("/{item_id}/approve", dependencies=[Depends(rate_limit())])
def approve(item_id: str, body: Decision = Decision(), claims: dict = Depends(current_user),
            engine: Engine = Depends(get_engine)):
    return _decide(item_id, claims["sub"], "approved", body, engine)


@router.post("/{item_id}/reject", dependencies=[Depends(rate_limit())])
def reject(item_id: str, body: Decision = Decision(), claims: dict = Depends(current_user),
           engine: Engine = Depends(get_engine)):
    return _decide(item_id, claims["sub"], "rejected", body, engine)
