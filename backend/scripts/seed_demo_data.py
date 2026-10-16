"""Give a local account the synthetic demo data: the eval world's user u1 (transactions, line items, documents)
moved so the year ends yesterday, plus a person's rent, phone, gym and food delivery, a rental agreement and the
demo profile, so the agent and document search have something real to work with.

    python -m scripts.seed_demo_data --user-id <your Supabase user id>          # local database only

Re-running replaces only the seeded transactions (your own uploads are never touched, and your user row only gets
the demo profile if you haven't finished onboarding);
documents are deduplicated by content. Ids are derived from your user id, so seeded rows never collide with the
eval world or another account. Invoice numbers can collide with an invoice you uploaded yourself only if it has
exactly the same synthetic number. Refuses non-SQLite databases unless
--allow-postgres is given (it's demo data, not for production).
"""
from __future__ import annotations

import argparse
import functools
import logging
import random
import re
import sys
import threading
import time as clock
import uuid
from datetime import date, datetime, time, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
logger = logging.getLogger(__name__)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--allow-postgres", action="store_true")
    args = parser.parse_args(argv)
    uuid.UUID(args.user_id)  # must be a real user id

    from sqlalchemy import create_engine

    from config import Config
    from rag.embed import FastEmbedder
    from rag.store import ChunkStore

    engine = create_engine(Config.DATABASE_URI)
    if engine.dialect.name != "sqlite" and not args.allow_postgres:
        print("Refusing to seed a non-SQLite database without --allow-postgres.")
        return 2
    counts = seed(engine, ChunkStore(engine), FastEmbedder(), args.user_id)
    print(f"Seeded {counts['transactions']} transactions, {counts['transaction_items']} line items and "
          f"{counts['documents']} documents for {args.user_id[:8]}…")
    [t.join() for t in threading.enumerate() if t.name == "demo-uploads"]  # let the file uploads finish
    return 0


def _months_back(d: date, n: int) -> date:
    """`d` moved n calendar months back (forward when n < 0), the day clamped to 28."""
    y, m = divmod(d.year * 12 + d.month - 1 - n, 12)
    return date(y, m + 1, min(d.day, 28))


def _life_rows(user_id: str, yesterday: date, remap) -> list[dict]:
    """A person's own regular spending for the 12 months ending `yesterday`: rent, phone, gym, food delivery
    (with one double charge this month). Same keys as the world's transactions."""
    rng = random.Random(user_id)  # stable per account
    where = {"Greenview Residency": "HSR Layout, Bengaluru", "SkyTel Mobile": "MG Road, Bengaluru",
             "FitZone Gym": "Koramangala 5th Block, Bengaluru", "QuickBite": "Indiranagar, Bengaluru"}

    def row(vendor, when, amount, category, method, invoice, tax_rate=0.0, n=0):
        return {"id": remap(f"life-{vendor}-{when:%Y-%m}-{n}"), "user_id": user_id, "vendor_name": vendor,
                "invoice_number": invoice, "date": when.isoformat(), "total_amount": amount,
                "tax_amount": round(amount * tax_rate / (1 + tax_rate), 2), "payment_method": method,
                "address": where[vendor], "category": category, "created_at": datetime.combine(when, time(12))}

    rows = []
    for k in range(12):
        first = _months_back(yesterday, k).replace(day=1)
        on = lambda day: first.replace(day=day)
        ym = f"{first:%Y%m}"
        month = [row("Greenview Residency", on(rng.randint(1, 5)), 22000.0, "Housing", "UPI", f"GR-{ym}"),
                 row("SkyTel Mobile", on(8), 649.0 if k < 3 else 499.0, "Utilities", "Debit Card", f"ST-{ym}", 0.18),
                 row("FitZone Gym", on(3), 1500.0, "Healthcare", "UPI", f"FZ-{ym}", 0.18)]
        orders = rng.randint(3, 6)  # this month's last order is by yesterday, so the double charge always exists
        month += [row("QuickBite", on(rng.randint(1, yesterday.day if k == 0 and n == orders - 1 else 28)),
                      round(rng.uniform(250, 700), 2), "Restaurant", "UPI", f"QB-{ym}-{n + 1:02d}", 0.05, n)
                  for n in range(orders)]
        if k == 0:  # this month: only what has happened by yesterday, and the last order charged twice
            month = [r for r in month if r["date"] <= yesterday.isoformat()]
            month.append({**month[-1], "id": remap(f"life-QuickBite-{ym}-dup"),
                          "invoice_number": month[-1]["invoice_number"] + "-2"})
        rows += month
    return rows


def _rental_agreement(today: date) -> dict:
    """The demo tenant's lease: 12 months from the first rent month, so it ends within a month from now."""
    start = _months_back(today - timedelta(days=1), 11).replace(day=1)
    end = _months_back(start, -12)
    day = lambda d: f"{d.day} {d:%B %Y}"
    return {"title": "Rental agreement - Greenview Residency, Flat 304", "sections": [
        {"heading": "Parties", "text": "This agreement is between Ramesh Iyer (the landlord), owner of Flat 304, "
                                       "Greenview Residency, HSR Layout, Bengaluru, and the tenant."},
        {"heading": "Term", "text": f"The tenancy runs for 12 months, from {day(start)} to {day(end)}. "
                                    "It can be renewed by both parties in writing."},
        {"heading": "Rent", "text": "Monthly rent is INR 22,000, due by the 5th of each month by UPI or bank transfer."},
        {"heading": "Security deposit", "text": "The tenant has paid a refundable security deposit of INR 66,000 "
                                                "(three months of rent), returned within 15 days of moving out."},
        {"heading": "Notice period", "text": "Either party may end the tenancy with 30 days of written notice."},
        {"heading": "Rent increase", "text": "On renewal the rent increases by 5% each year."},
        {"heading": "Maintenance", "text": "Society maintenance is included in the rent. The tenant pays electricity "
                                           "and repairs under INR 2,000; the landlord pays for larger repairs."},
    ]}


@functools.lru_cache(maxsize=2)  # keyed on the embedder: the server has one, so every visitor reuses this
def demo_documents(embedder) -> list[tuple]:
    """(filename, doc_type, title, sections, vectors, pdf bytes) for each demo PDF, parsed and embedded once per
    process: on a small server this is most of a demo's setup time."""
    from rag.chunking import chunk_sections, sections_from_pdf
    from rag.ingest import passage_text

    out = []
    corpus = BACKEND / "evals" / "data" / "corpus"
    for path in sorted(p for p in corpus.glob("*.pdf") if "-u1-" in p.name or p.name.startswith("po-po-u1")):
        data = path.read_bytes()
        title, sections = sections_from_pdf(data)
        title = title or path.name
        vectors = embedder.embed_passages([passage_text(title, c.heading, c.text)
                                           for c in chunk_sections("demo", sections)])
        doc_type = ("purchase_order" if path.name.startswith("po-") else
                    "policy" if path.name.startswith("policy") else "contract")
        out.append((path.name, doc_type, title, sections, vectors, data))
    return out


def seed(engine, store, embedder, user_id: str, today: date | None = None) -> dict:
    """Give `user_id` the demo data, moved so the newest transaction is yesterday; also used by the one-click demo
    (api/demo.py). `today` is for tests."""
    import json
    import statistics

    from sqlalchemy import delete, insert, select, update

    import models  # noqa: F401  (registers the tables)
    from api.profile import DEMO_PROFILE
    from evals.generator.corpus import render_pdf
    from evals.generator.world import build_world
    from models.database import db
    from rag.chunking import chunk_sections
    from rag.ingest import ingest_pdf
    from utils import files

    t0 = clock.perf_counter()
    world = build_world(42)
    source = next(u for u in world["users"] if u["key"] == "u1")
    remap = lambda old: str(uuid.uuid5(uuid.UUID(user_id), old))  # stable per account
    txns = [t for t in world["transactions"] if t["user_id"] == source["id"]]
    txn_ids = {t["id"] for t in txns}
    today = today or date.today()
    shift = today - timedelta(days=1) - max(date.fromisoformat(t["date"]) for t in txns)  # whole days
    rows = [{**t, "id": remap(t["id"]), "user_id": user_id, "date": new.isoformat(),
             "created_at": datetime.fromisoformat(t["created_at"]) + shift,  # invoice month code follows the date
             "invoice_number": re.sub(r"-\d{6}-", f"-{new:%Y%m}-", t["invoice_number"], count=1)}
            for t in txns for new in [date.fromisoformat(t["date"]) + shift]]
    items = [{**i, "id": remap(i["id"]), "transaction_id": remap(i["transaction_id"])}
             for i in world["transaction_items"] if i["transaction_id"] in txn_ids]
    # The latest electricity bill jumps, so "why is my bill so high?" has something to find.
    power = sorted((r for r in rows if r["vendor_name"] == "City Power Ltd"), key=lambda r: r["date"])
    bill = power[-1]["total_amount"] = round(1.45 * statistics.median(r["total_amount"] for r in power[:-1]), 2)
    for i in items:
        if i["transaction_id"] == power[-1]["id"]:
            i.update(quantity=1, unit_price=bill, total_price=bill)
    rows += _life_rows(user_id, today - timedelta(days=1), remap)

    # Touch only the seeded rows: the account's own uploads are left alone.
    tables = db.metadata.tables
    db.metadata.create_all(engine, tables=[tables[t] for t in ("users", "receipts", "transactions", "transaction_items",
                                                                "purchase_orders")])
    pos = [{"id": remap(p["po_number"]), "user_id": user_id, "po_number": p["po_number"], "vendor_name": p["vendor_name"],
            "issue_date": p["issue_date"], "lines": json.dumps(p["lines"]), "currency": p["currency"]}
           for p in world["purchase_orders"] if p["user_id"] == source["id"]]
    with engine.begin() as conn:
        if conn.execute(select(tables["users"].c.id).where(tables["users"].c.id == user_id)).first() is None:
            conn.execute(insert(tables["users"]), [{"id": user_id, "email": f"{user_id[:8]}@local.demo"}])
        users = tables["users"]  # the demo profile, unless the account already finished onboarding
        conn.execute(update(users).where(users.c.id == user_id, users.c.onboarded_at.is_(None)).values(
            **{k: DEMO_PROFILE[k] for k in ("display_name", "currency", "monthly_income", "monthly_budget", "use_case")},
            goals=json.dumps(DEMO_PROFILE["goals"]), onboarded_at=datetime.utcnow()))
        seeded_ids = [r["id"] for r in rows]
        conn.execute(delete(tables["transaction_items"]).where(tables["transaction_items"].c.transaction_id.in_(seeded_ids)))
        conn.execute(delete(tables["transactions"]).where(tables["transactions"].c.id.in_(seeded_ids)))
        conn.execute(insert(tables["transactions"]), rows)
        conn.execute(insert(tables["transaction_items"]), items)
        conn.execute(delete(tables["purchase_orders"]).where(tables["purchase_orders"].c.id.in_([p["id"] for p in pos])))
        if pos:
            conn.execute(insert(tables["purchase_orders"]), pos)
    t_rows = clock.perf_counter()
    store.ensure_schema()
    docs, uploads = demo_documents(embedder), []
    for filename, doc_type, title, sections, vectors, data in docs:
        doc_id = str(uuid.uuid4())
        doc_id = store.upsert_document(doc_id=doc_id, user_id=user_id, title=title, doc_type=doc_type,
                                       filename=filename, chunks=chunk_sections(doc_id, sections), vectors=vectors,
                                       embedding_model=embedder.model_id)
        uploads.append((files.document_key(user_id, doc_id), data))  # so "Open original" works for demo documents
    data = render_pdf(_rental_agreement(today))
    doc_id = ingest_pdf(store, embedder, user_id=user_id, data=data, filename="rental-agreement-greenview.pdf",
                        doc_type="contract")
    uploads.append((files.document_key(user_id, doc_id), data))
    t_docs = clock.perf_counter()

    def upload():
        try:
            for key, blob in uploads:
                files.keep(key, blob)
        except Exception as e:  # the demo works without originals; only "Open original" is missing
            logger.warning("Demo file uploads stopped: %s", type(e).__name__)

    threading.Thread(target=upload, name="demo-uploads", daemon=True).start()
    logger.info("Demo seed: rows %.1fs, documents %.1fs, %d uploads queued", t_rows - t0, t_docs - t_rows, len(uploads))
    return {"transactions": len(rows), "transaction_items": len(items), "documents": len(docs) + 1}


if __name__ == "__main__":
    sys.exit(main())
