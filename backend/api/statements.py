"""SPEC-STATEMENTS: preview and import a CSV bank/card statement."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict
from datetime import date, timedelta
from functools import lru_cache

from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from api.profile import ensure_user
from statements import read, vendor

router = APIRouter(prefix="/api/statements", tags=["statements"])
MAX_BYTES = 5 * 1024 * 1024


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    from config import Config

    return create_engine(Config.DATABASE_URI, pool_pre_ping=True)


class NoHeader(Exception):
    def __init__(self, raw):
        self.raw = raw


def _no_header(e: NoHeader) -> JSONResponse:
    # the shared error handler flattens HTTPException.detail to a string, so build the body here
    msg = "This doesn't look like a CSV statement: no date and amount columns found."
    return JSONResponse({"success": False, "error": msg, "code": "no_header",
                         "detail": {"message": msg, "raw": e.raw}}, 400)


def _load(file: UploadFile):
    """(rows, header_index) from the upload, or the 413/400 an unusable file deserves."""
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "That file is over 5 MB. Export a shorter date range.")
    parsed = [] if b"\x00" in data else read.rows(read.decode(data))
    header = read.find_header(parsed)
    if header is None:
        raise NoHeader(parsed[:10])
    return parsed, header


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 3}


@router.post("/preview", dependencies=[Depends(rate_limit("10 per minute"))])
def preview(file: UploadFile = File(...), claims: dict = Depends(current_user)):
    try:
        parsed, header = _load(file)
    except NoHeader as e:
        return _no_header(e)
    mapping = read.guess_mapping(parsed[header])
    lines = read.parse(parsed, header, mapping)
    bad = sum(1 for ln in lines if ln.date is None or ln.amount is None)
    return {"success": True, "columns": parsed[header], "mapping": mapping, "header_line": header + 1,
            "sample": [asdict(ln) for ln in lines[:5]],
            "counts": {"rows": len(lines), "debits": sum(ln.kind == "debit" for ln in lines),
                       "credits": sum(ln.kind == "credit" for ln in lines), "unreadable": bad}}


@router.post("/import", dependencies=[Depends(rate_limit("10 per minute"))])
def import_statement(file: UploadFile = File(...), mapping: str = Form(...), currency: str | None = Form(None),
                     header_line: int | None = Form(None), claims: dict = Depends(current_user),
                     engine: Engine = Depends(get_engine)):
    from config import Config
    from models import Transaction, User

    try:
        parsed, header = _load(file)
    except NoHeader as e:
        return _no_header(e)
    if header_line is not None and 1 <= header_line <= len(parsed):
        header = header_line - 1
    try:
        chosen = {**dict.fromkeys(read._ORDER), **json.loads(mapping)}
        assert all(k in read._ORDER and (v is None or isinstance(v, int)) for k, v in chosen.items())
    except (ValueError, AssertionError):
        raise HTTPException(400, "The column mapping is not valid.")
    lines = read.parse(parsed, header, chosen)
    user_id = claims["sub"]
    unreadable = [ln.line for ln in lines if ln.date is None or ln.amount is None]
    debits = [ln for ln in lines if ln.date and ln.amount and ln.kind == "debit"]
    credits = sum(1 for ln in lines if ln.date and ln.amount and ln.kind == "credit")

    with Session(engine) as session:
        user = ensure_user(session, user_id, claims.get("email"))
        code = currency or user.currency or Config.DEFAULT_CURRENCY
        have = set(session.scalars(select(Transaction.import_key).where(Transaction.user_id == user_id)))
        candidates = []
        if debits:
            days = [date.fromisoformat(ln.date) for ln in debits]
            lo, hi = (min(days) - timedelta(days=3)).isoformat(), (max(days) + timedelta(days=3)).isoformat()
            candidates = session.execute(select(Transaction.vendor_name, Transaction.total_amount, Transaction.date)
                                         .where(Transaction.user_id == user_id, Transaction.source.is_(None),
                                                Transaction.date >= lo, Transaction.date <= hi)).all()
        imported = duplicates = matched = 0
        for ln in debits:
            key = hashlib.sha1(f"{user_id}|{ln.date}|{ln.amount:.2f}|{ln.description}".encode()).hexdigest()
            if key in have:
                duplicates += 1
                continue
            name = vendor.clean(ln.description)
            day = date.fromisoformat(ln.date)
            if any(t.total_amount is not None and abs(ln.amount - t.total_amount) < 0.01 and t.date
                   and abs((day - date.fromisoformat(t.date[:10])).days) <= 3
                   and _words(name) & _words(t.vendor_name or "") for t in candidates):
                matched += 1  # ponytail: not stored, so a re-import matches (and counts) again
                continue
            session.add(Transaction(user_id=user_id, vendor_name=name, date=ln.date, total_amount=ln.amount,
                                    category=vendor.category(name), currency=code, source="statement",
                                    import_key=key, invoice_number=None))
            imported += 1
        session.commit()
    return {"success": True, "imported": imported, "duplicates": duplicates, "matched": matched,
            "credits": credits, "unreadable": unreadable}
