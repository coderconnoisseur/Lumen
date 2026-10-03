"""Load a generated world into a database with the app's own schema (SQLite in CI, pgserver Postgres
locally). Purchase orders stay in evals/data until SPEC-EXTRACT defines their table."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, insert
from sqlalchemy.engine import Engine

import models  # noqa: F401  (registers the tables on db.metadata)
from models.database import db

_TABLES = ("users", "transactions", "transaction_items")


def load_world(engine: Engine, world: dict) -> None:
    """Create the tables if needed and replace the world's users and their rows."""
    tables = {name: db.metadata.tables[name] for name in _TABLES}
    db.metadata.create_all(engine, tables=list(tables.values()))
    user_ids = [u["id"] for u in world["users"]]
    txn = tables["transactions"]
    item = tables["transaction_items"]
    with engine.begin() as conn:
        txn_ids = txn.select().with_only_columns(txn.c.id).where(txn.c.user_id.in_(user_ids))
        conn.execute(delete(item).where(item.c.transaction_id.in_(txn_ids)))
        conn.execute(delete(txn).where(txn.c.user_id.in_(user_ids)))
        conn.execute(delete(tables["users"]).where(tables["users"].c.id.in_(user_ids)))

        conn.execute(insert(tables["users"]), [{"id": u["id"], "email": u["email"]} for u in world["users"]])
        conn.execute(insert(txn), [
            {**t, "created_at": datetime.fromisoformat(t["created_at"])} for t in world["transactions"]
        ])
        conn.execute(insert(item), world["transaction_items"])
