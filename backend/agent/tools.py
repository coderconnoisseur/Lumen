"""The agent's tools (SPEC-AGENT, AGT-01).

Every tool:
- takes typed arguments (a Pydantic model, which also produces the JSON schema the model sees);
- gets the user id from `ToolContext`, built server-side from the JWT. No tool accepts a user id argument, so
  the model can't ask for someone else's data;
- returns compact JSON-able results, capped so one big result can't flood the model's context.
Tools wrap code that is already tested (SQL guardrails, hybrid retrieval, the anomaly rules), so the agent adds
routing, not new attack surface. `propose_action` is the only tool that writes, and it writes a *pending*
proposal plus an audit event; a human approves or rejects it through a separate API call.
"""
from __future__ import annotations

import difflib
import json
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

MAX_ROWS = 50  # rows returned to the model from run_sql
MAX_TEXT = 600  # characters per document passage returned to the model


@dataclass
class ToolContext:
    user_id: str
    engine: Engine  # the app database (transactions, items, proposals)
    sql_agent: Any  # ai.sql_agent.SQLAgent bound to the same database
    rag: Any = None  # rag.service.RagService, or None when document search is unavailable
    today: date = field(default_factory=date.today)


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    run: Callable[[ToolContext, BaseModel], dict]


# --- argument models ---------------------------------------------------------------------------------------

class NoArgs(BaseModel):
    pass


class LookupVendorsArgs(BaseModel):
    hint: str | None = Field(None, description="Words to match against vendor names, categories and item names, "
                                                "e.g. 'electricity' or 'techhub'. Omit to list all vendors.")


class RunSqlArgs(BaseModel):
    sql: str = Field(description="One read-only SELECT over transactions / transaction_items. Don't filter by "
                                 "user_id: queries only ever see this user's rows.")


class SearchDocumentsArgs(BaseModel):
    query: str = Field(description="What to look for in the user's uploaded documents (contracts, POs, policies).")


class GetInvoiceArgs(BaseModel):
    invoice_number: str = Field(description="The invoice number, e.g. 'CP-202606-U1N18'.")


class ForecastArgs(BaseModel):
    months: int = Field(1, ge=1, le=6, description="How many months ahead to project.")


class ProposeActionArgs(BaseModel):
    type: Literal["flag_invoice", "mark_paid", "update_category", "follow_up_vendor"]
    target: str = Field(description="What the action applies to, e.g. an invoice number or vendor name.")
    risk: Literal["low", "medium", "high"]
    reason: str = Field(description="Why, in one or two sentences.")
    payload: dict = Field(default_factory=dict, description="Action details, e.g. {'category': 'Utilities'}.")
    evidence: list[str] = Field(default_factory=list, description="Chunk ids or SQL that support the reason.")


# --- implementations -----------------------------------------------------------------------------------------

def _get_schema(ctx: ToolContext, _: NoArgs) -> dict:
    """Generated from the models, so it can't drift from the real tables (builder finding 6b #13)."""
    from models import Transaction, TransactionItem

    def columns(model):
        return {c.name: str(c.type) for c in model.__table__.columns}

    return {
        "tables": {"transactions": columns(Transaction), "transaction_items": columns(TransactionItem)},
        "notes": [
            "transactions.date is TEXT 'YYYY-MM-DD'; compare as strings, e.g. date >= '2026-01-01'.",
            "Amounts are in INR. category values are Title Case (Groceries, Utilities, Transport, ...).",
            "Vendor names are exact strings: use lookup_vendors to find the real name before filtering.",
            f"Today is {ctx.today.isoformat()}.",
        ],
    }


def _lookup_vendors(ctx: ToolContext, args: LookupVendorsArgs) -> dict:
    """The user's real vendors, matched on name, category and the items bought there. Fixes the measured
    failure where the model guessed `vendor_name LIKE '%electric%'` for a vendor called "City Power Ltd"."""
    with ctx.engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT t.vendor_name AS vendor, t.category AS category, COUNT(DISTINCT t.id) AS n, "
            "SUM(t.total_amount) AS total FROM transactions t WHERE t.user_id = :u AND t.vendor_name IS NOT NULL "
            "GROUP BY t.vendor_name, t.category"), {"u": ctx.user_id}).mappings().all()
        items = conn.execute(text(
            "SELECT DISTINCT t.vendor_name AS vendor, ti.item_name AS item FROM transaction_items ti "
            "JOIN transactions t ON t.id = ti.transaction_id WHERE t.user_id = :u"), {"u": ctx.user_id}).mappings().all()
    items_by_vendor: dict[str, list[str]] = {}
    for r in items:
        items_by_vendor.setdefault(r["vendor"], []).append(r["item"])
    vendors = [{"vendor": r["vendor"], "category": r["category"], "transactions": r["n"],
                "total_spent": round(r["total"] or 0, 2), "items": sorted(items_by_vendor.get(r["vendor"], []))[:5]}
               for r in rows]
    if args.hint:
        words = [w for w in args.hint.lower().split() if len(w) > 2] or [args.hint.lower()]

        def score(v: dict) -> float:
            hay = " ".join([v["vendor"], v["category"] or "", *v["items"]]).lower()
            best = max(difflib.SequenceMatcher(None, w, token).ratio() for w in words for token in hay.split())
            return best + sum(0.5 for w in words if w in hay)

        vendors = [v for v in sorted(vendors, key=lambda v: (-score(v), v["vendor"])) if score(v) >= 0.75][:10]
    else:
        vendors = sorted(vendors, key=lambda v: (-v["transactions"], v["vendor"]))[:30]
    return {"vendors": vendors}


def _run_sql(ctx: ToolContext, args: RunSqlArgs) -> dict:
    sql = args.sql.replace("{user_id}", ctx.user_id)
    # Validated (read-only, allowed tables, no other user's id) and scoped to the user server-side; the model
    # never sees the user id, so it isn't required to filter by it.
    result = ctx.sql_agent.execute_sql(sql, ctx.user_id, require_user_filter=False)
    if not result.get("success"):
        return {"sql": args.sql, "error": result.get("reason") or result.get("error") or "query failed",
                "hint": "One SELECT on transactions/transaction_items. Check column names with get_schema."}
    rows = result.get("data") or []
    return {"sql": args.sql, "row_count": len(rows), "rows": json.loads(json.dumps(rows[:MAX_ROWS], default=str)),
            "truncated": len(rows) > MAX_ROWS}


def _search_documents(ctx: ToolContext, args: SearchDocumentsArgs) -> dict:
    if ctx.rag is None:
        return {"error": "document search is unavailable"}
    hits = ctx.rag.search(ctx.user_id, args.query, k=5)
    return {"passages": [{"chunk_id": h.chunk_id, "title": h.title, "section": h.heading,
                          "text": h.text[:MAX_TEXT]} for h in hits]}


def _get_invoice(ctx: ToolContext, args: GetInvoiceArgs) -> dict:
    with ctx.engine.connect() as conn:
        txn = conn.execute(text(
            "SELECT id, vendor_name, invoice_number, date, total_amount, tax_amount, payment_method, category "
            "FROM transactions WHERE user_id = :u AND UPPER(invoice_number) = UPPER(:n)"),
            {"u": ctx.user_id, "n": args.invoice_number.strip()}).mappings().first()
        if txn is None:
            return {"found": False, "invoice_number": args.invoice_number}
        items = conn.execute(text(
            "SELECT item_name, quantity, unit_price, total_price FROM transaction_items WHERE transaction_id = :t"),
            {"t": txn["id"]}).mappings().all()
    return {"found": True, "invoice": {k: v for k, v in dict(txn).items() if k != "id"},
            "items": [dict(i) for i in items]}


def _transactions_since(ctx: ToolContext, days: int) -> list[dict]:
    cutoff = (ctx.today - timedelta(days=days)).isoformat()
    with ctx.engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(
            "SELECT id, vendor_name, invoice_number, date, total_amount, category FROM transactions "
            "WHERE user_id = :u AND date >= :c AND date <= :t ORDER BY date DESC"),
            {"u": ctx.user_id, "c": cutoff, "t": ctx.today.isoformat()}).mappings()]


def _get_anomalies(ctx: ToolContext, _: NoArgs) -> dict:
    """The existing statistical and rule-based detectors (no LLM) over the last 90 days."""
    from ai.anomaly_detection import FraudDetectionAgent

    txns = _transactions_since(ctx, 90)
    detector = FraudDetectionAgent()
    found = detector.statistical_anomaly_detection(txns) + detector.rule_based_detection(txns)
    by_id = {str(t["id"]): t for t in txns}  # the detectors return only the transaction id
    by_txn: dict[str, dict] = {}
    for a in found:
        key = str(a.get("transaction_id") or a.get("id"))
        t = by_id.get(key, a)
        entry = by_txn.setdefault(key, {"vendor": t.get("vendor_name"), "date": t.get("date"),
                                        "amount": t.get("total_amount", t.get("amount")), "reasons": []})
        entry["reasons"].append(a.get("explanation") or a.get("anomaly_type") or "unusual")
    ranked = sorted(by_txn.values(), key=lambda e: (-len(e["reasons"]), str(e["date"])))[:10]
    return {"window_days": 90, "transactions_checked": len(txns), "anomalies": ranked}


def _forecast(ctx: ToolContext, args: ForecastArgs) -> dict:
    """Monthly totals for the last 6 full months, a least-squares trend, and the projection (no LLM)."""
    first_of_month = ctx.today.replace(day=1)
    months = []
    cursor = first_of_month
    for _ in range(6):
        cursor = (cursor - timedelta(days=1)).replace(day=1)
        months.append(cursor)
    months.reverse()
    with ctx.engine.connect() as conn:
        totals = {r["m"]: r["total"] for r in conn.execute(text(
            "SELECT substr(date, 1, 7) AS m, SUM(total_amount) AS total FROM transactions WHERE user_id = :u "
            "AND date >= :a AND date < :b GROUP BY substr(date, 1, 7)"),
            {"u": ctx.user_id, "a": months[0].isoformat(), "b": first_of_month.isoformat()}).mappings()}
    history = [round(totals.get(m.strftime("%Y-%m"), 0.0) or 0.0, 2) for m in months]
    n = len(history)
    mean_x, mean_y = (n - 1) / 2, sum(history) / n
    denom = sum((x - mean_x) ** 2 for x in range(n)) or 1
    slope = sum((x - mean_x) * (y - mean_y) for x, y in enumerate(history)) / denom
    projection, month = [], first_of_month
    for k in range(args.months):
        projection.append({"month": month.strftime("%Y-%m"), "projected_total": round(max(0.0, mean_y + slope * (n + k - mean_x)), 2)})
        month = (month + timedelta(days=32)).replace(day=1)
    return {"history": [{"month": m.strftime("%Y-%m"), "total": t} for m, t in zip(months, history)],
            "trend_per_month": round(slope, 2), "projection": projection,
            "method": "least-squares trend over the last 6 full months"}


def _propose_action(ctx: ToolContext, args: ProposeActionArgs) -> dict:
    from models import AuditEvent, Proposal

    proposal_id = str(uuid.uuid4())
    with Session(ctx.engine) as session, session.begin():
        session.add(Proposal(id=proposal_id, user_id=ctx.user_id, type=args.type, target=args.target,
                             payload=json.dumps(args.payload), risk=args.risk, reason=args.reason,
                             evidence=json.dumps(args.evidence), status="pending"))
        session.add(AuditEvent(user_id=ctx.user_id, actor="agent", action="proposal_created", proposal_id=proposal_id,
                               detail=json.dumps({"type": args.type, "target": args.target, "risk": args.risk})))
    return {"proposal_id": proposal_id, "status": "pending",
            "note": "Filed for human review. Nothing has been changed."}


TOOLS: dict[str, Tool] = {t.name: t for t in (
    Tool("get_schema", "The tables and columns you can query with run_sql, with notes on dates, amounts and today's date.",
         NoArgs, _get_schema),
    Tool("lookup_vendors", "Find the user's real vendor names (with category, items bought and totals). Use before "
         "filtering by vendor or by a kind of purchase like 'electricity'.", LookupVendorsArgs, _lookup_vendors),
    Tool("run_sql", "Run one read-only SQL SELECT over the user's transactions and line items; returns rows.",
         RunSqlArgs, _run_sql),
    Tool("search_documents", "Search the user's uploaded documents (contracts, purchase orders, policies) and return "
         "passages with ids to cite.", SearchDocumentsArgs, _search_documents),
    Tool("get_invoice", "Look up one invoice by its number, with its line items.", GetInvoiceArgs, _get_invoice),
    Tool("get_anomalies", "Unusual transactions in the last 90 days (statistical and rule checks), with reasons.",
         NoArgs, _get_anomalies),
    Tool("forecast", "Project total spending for the coming months from the last 6 months' trend.", ForecastArgs, _forecast),
    Tool("propose_action", "Propose an action for a human to approve (never applied directly): flag an invoice, mark "
         "paid, change a category, or follow up with a vendor.", ProposeActionArgs, _propose_action),
)}


def _clean(schema: dict) -> dict:
    """Drop Pydantic's `title` keys: they cost tokens (Groq's free tier allows 8K a minute) and add nothing."""
    if isinstance(schema, dict):
        return {k: _clean(v) for k, v in schema.items() if k != "title"}
    if isinstance(schema, list):
        return [_clean(v) for v in schema]
    return schema


def tool_schemas(names: list[str] | None = None) -> list[dict]:
    """OpenAI-style function definitions for the model."""
    return [{"type": "function", "function": {"name": t.name, "description": t.description,
                                               "parameters": _clean(t.args.model_json_schema())}}
            for t in TOOLS.values() if names is None or t.name in names]


def run_tool(ctx: ToolContext, name: str, raw_args: str | dict | None) -> dict:
    """Validate the model's arguments and run the tool. Errors come back as data the model can correct."""
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": f"unknown tool {name!r}; available: {', '.join(TOOLS)}"}
    try:
        data = json.loads(raw_args) if isinstance(raw_args, str) and raw_args.strip() else (raw_args or {})
        args = tool.args.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as e:
        return {"error": f"invalid arguments for {name}: {e}"[:500]}
    return tool.run(ctx, args)
