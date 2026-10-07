"""Deterministic checks on an extracted invoice (SPEC-EXTRACT, EXT-02/03/04). No LLM.

Each planted fault in the eval invoices has one rule meant to catch it, so detection is measurable per fault type
(`evals/suites/validation.py`). Confidence comes from these checks, never from asking the model how sure it is.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

TOLERANCE = 0.01  # totals and PO amounts may differ by 1% (rounding, printed values)
MAX_AGE = timedelta(days=730)
_INJECTION = re.compile(r"ignore (?:all |any )?(?:previous|prior|above) instructions|\bAI assistant\b|\bsystem\s*:|"
                        r"mark (?:this|the) invoice as (?:verified|approved|paid)|https?://", re.IGNORECASE)


@dataclass(frozen=True)
class Flag:
    rule: str
    severity: Literal["warn", "fail"]
    detail: str


@dataclass
class Context:
    """What the user's data says about this invoice."""
    today: date
    known_vendors: set[str] = field(default_factory=set)        # vendors the user has paid before
    seen_invoices: set[tuple[str, str]] = field(default_factory=set)  # (vendor lower-case, invoice number) stored
    purchase_orders: dict[str, dict] = field(default_factory=dict)    # po_number -> {"vendor_name", "lines"}


def _off(a: float, b: float) -> bool:
    return abs(a - b) > max(TOLERANCE * max(abs(a), abs(b)), 0.01)


def validate(inv: dict, ctx: Context) -> list[Flag]:
    flags: list[Flag] = []
    items = inv.get("items") or []
    amounts = [i.get("total", i.get("total_price")) for i in items]  # eval or upload shape
    subtotal = round(sum(a or 0 for a in amounts), 2)
    total, tax = inv.get("total_amount"), inv.get("tax_amount") or 0
    # An item the reader couldn't price is a misread, not a wrong total.
    if items and None not in amounts and total is not None and _off(subtotal + tax, total):
        flags.append(Flag("total_mismatch", "fail", f"line items {subtotal} + tax {tax} != total {total}"))

    vendor = inv.get("vendor_name") or ""
    if (vendor.lower(), inv.get("invoice_number")) in ctx.seen_invoices:
        flags.append(Flag("duplicate", "fail", f"{vendor} {inv.get('invoice_number')} is already recorded"))
    if ctx.known_vendors and vendor not in ctx.known_vendors:  # no history yet: every vendor is new
        flags.append(Flag("unknown_vendor", "warn", f"no earlier payments to {vendor or 'this vendor'}"))

    try:
        day = date.fromisoformat(str(inv.get("date")))
        if day > ctx.today or day < ctx.today - MAX_AGE:
            flags.append(Flag("bad_date", "fail", f"date {day} is in the future or over 2 years old"))
    except ValueError:
        flags.append(Flag("bad_date", "fail", f"unreadable date {inv.get('date')!r}"))

    if "currency" in inv and not inv["currency"]:  # only when the reader reports a currency field
        flags.append(Flag("no_currency", "warn", "no currency on the invoice"))

    po_number = inv.get("po_number")
    if po_number:
        po = ctx.purchase_orders.get(po_number)
        if po is None:
            flags.append(Flag("unknown_po", "warn", f"no purchase order {po_number}"))
        else:
            ordered = round(sum(l["quantity"] * l["unit_price"] for l in po["lines"]), 2)
            if po["vendor_name"] != vendor or _off(ordered, subtotal):
                flags.append(Flag("po_mismatch", "fail",
                                  f"{po_number} is {po['vendor_name']} for {ordered}; invoice is {vendor} for {subtotal}"))

    text = " ".join(str(v) for v in (inv.get("notes"), vendor, inv.get("address")) if v)
    if _INJECTION.search(text):
        flags.append(Flag("possible_injection", "fail", "instruction-like text on the invoice"))
    return flags


def confidence(flags: list[Flag]) -> Literal["high", "medium", "low"]:
    if any(f.severity == "fail" for f in flags):
        return "low"
    return "medium" if flags else "high"
