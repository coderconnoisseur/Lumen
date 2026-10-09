"""Give a local account the synthetic demo data: a year of transactions (and line items) plus the documents of
the eval world's user u1, so the agent and document search have something real to work with.

    python -m scripts.seed_demo_data --user-id <your Supabase user id>          # local database only

Re-running replaces only the seeded transactions (your own uploads and your user row are never touched);
documents are deduplicated by content. Ids are derived from your user id, so seeded rows never collide with the
eval world or another account. Invoice numbers can collide with an invoice you uploaded yourself only if it has
exactly the same synthetic number. Refuses non-SQLite databases unless
--allow-postgres is given (it's demo data, not for production).
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


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
    return 0


def seed(engine, store, embedder, user_id: str) -> dict:
    """Give `user_id` the demo data; also used by the one-click demo (api/demo.py)."""
    import json
    from datetime import datetime

    from sqlalchemy import delete, insert, select

    import models  # noqa: F401  (registers the tables)
    from evals.generator.world import build_world
    from models.database import db
    from rag.ingest import ingest_pdf
    from utils import files

    world = build_world(42)
    source = next(u for u in world["users"] if u["key"] == "u1")
    remap = lambda old: str(uuid.uuid5(uuid.UUID(user_id), old))  # stable per account
    txns = [t for t in world["transactions"] if t["user_id"] == source["id"]]
    txn_ids = {t["id"] for t in txns}
    rows = [{**t, "id": remap(t["id"]), "user_id": user_id,
             "created_at": datetime.fromisoformat(t["created_at"])} for t in txns]
    items = [{**i, "id": remap(i["id"]), "transaction_id": remap(i["transaction_id"])}
             for i in world["transaction_items"] if i["transaction_id"] in txn_ids]

    # Touch only the seeded rows: the account's own uploads and its users row are left alone.
    tables = db.metadata.tables
    db.metadata.create_all(engine, tables=[tables[t] for t in ("users", "receipts", "transactions", "transaction_items",
                                                                "purchase_orders")])
    pos = [{"id": remap(p["po_number"]), "user_id": user_id, "po_number": p["po_number"], "vendor_name": p["vendor_name"],
            "issue_date": p["issue_date"], "lines": json.dumps(p["lines"]), "currency": p["currency"]}
           for p in world["purchase_orders"] if p["user_id"] == source["id"]]
    with engine.begin() as conn:
        if conn.execute(select(tables["users"].c.id).where(tables["users"].c.id == user_id)).first() is None:
            conn.execute(insert(tables["users"]), [{"id": user_id, "email": f"{user_id[:8]}@local.demo"}])
        seeded_ids = [r["id"] for r in rows]
        conn.execute(delete(tables["transaction_items"]).where(tables["transaction_items"].c.transaction_id.in_(seeded_ids)))
        conn.execute(delete(tables["transactions"]).where(tables["transactions"].c.id.in_(seeded_ids)))
        conn.execute(insert(tables["transactions"]), rows)
        conn.execute(insert(tables["transaction_items"]), items)
        conn.execute(delete(tables["purchase_orders"]).where(tables["purchase_orders"].c.id.in_([p["id"] for p in pos])))
        if pos:
            conn.execute(insert(tables["purchase_orders"]), pos)
    store.ensure_schema()
    corpus = BACKEND / "evals" / "data" / "corpus"
    docs = sorted(p for p in corpus.glob("*.pdf") if "-u1-" in p.name or p.name.startswith("po-po-u1"))
    for path in docs:
        data = path.read_bytes()
        doc_id = ingest_pdf(store, embedder, user_id=user_id, data=data, filename=path.name,
                            doc_type="purchase_order" if path.name.startswith("po-") else
                            "policy" if path.name.startswith("policy") else "contract")
        files.keep(files.document_key(user_id, doc_id), data)  # so "Open original" works for demo documents
    return {"transactions": len(rows), "transaction_items": len(items), "documents": len(docs)}


if __name__ == "__main__":
    sys.exit(main())
