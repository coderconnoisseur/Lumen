import logging
from datetime import datetime

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text

from config import Config

logger = logging.getLogger(__name__)

db = SQLAlchemy()


def _migrate_transaction_unique_index(app: Flask) -> None:
    """Move dedup constraint from global (vendor, invoice) to per-user."""
    with app.app_context():
        try:
            inspector = inspect(db.engine)
            indexes = {idx["name"] for idx in inspector.get_indexes("transactions")}
            if "u_vendor_invoice" in indexes:
                db.session.execute(text("DROP INDEX u_vendor_invoice"))
            db.session.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS u_user_vendor_invoice "
                    "ON transactions (user_id, vendor_name, invoice_number)"
                )
            )
            db.session.commit()
            logger.info("Transaction unique index migration applied")
        except Exception as e:
            db.session.rollback()
            logger.warning("Transaction index migration skipped: %s", e)


# Columns added after their table first shipped (create_all doesn't alter existing tables). All nullable.
_ADDED_COLUMNS = {
    "budgets": [("effective_from", "VARCHAR(7)")],  # UI revamp Phase 5d: budgets per month
    "chat_messages": [("thread_id", "VARCHAR(36)")],  # UI revamp Phase 4: chat threads
    "review_items": [("extracted", "TEXT")],  # SPEC-FEEDBACK
    "transactions": [("currency", "VARCHAR(3)"), ("po_number", "VARCHAR"), ("file_key", "VARCHAR"),
                     ("source", "VARCHAR"), ("import_key", "VARCHAR")],  # EXT-01, SPEC-STATEMENTS
    "users": [("display_name", "VARCHAR"), ("avatar_key", "VARCHAR"), ("currency", "VARCHAR(3)"),
              ("monthly_income", "FLOAT"), ("monthly_budget", "FLOAT"), ("use_case", "VARCHAR"),
              ("goals", "TEXT"), ("onboarded_at", "TIMESTAMP"),
              ("notes", "TEXT")],  # SPEC-ONBOARD, agent notes
}


def _add_missing_columns() -> None:
    for table, columns in _ADDED_COLUMNS.items():
        try:
            have = {c["name"] for c in inspect(db.engine).get_columns(table)}
            for name, sql_type in columns:
                if name not in have:
                    with db.engine.begin() as conn:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
                    logger.info("Added %s.%s", table, name)
        except Exception as e:
            logger.warning("Column migration for %s skipped: %s", table, e)


def _migrate_budget_versions(engine) -> None:
    """Phase 5d: budgets went from one row per (user, category) to one per month. Dates older rows by their last
    update and swaps the unique constraint. SQLite can't drop a table constraint, so there the table is rebuilt.
    Idempotent."""
    insp = inspect(engine)
    if "budgets" not in insp.get_table_names():
        return
    old = any(set(u["column_names"]) == {"user_id", "category"} for u in insp.get_unique_constraints("budgets"))
    with engine.begin() as conn:
        if old and engine.dialect.name == "sqlite":
            conn.execute(text("ALTER TABLE budgets RENAME TO budgets_pre_5d"))
            conn.execute(text("CREATE TABLE budgets (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, "
                              "category VARCHAR NOT NULL, monthly_limit FLOAT NOT NULL, effective_from VARCHAR(7), "
                              "updated_at DATETIME)"))
            have = {c["name"] for c in insp.get_columns("budgets_pre_5d")}
            eff = "effective_from" if "effective_from" in have else "NULL"
            conn.execute(text(f"INSERT INTO budgets (id, user_id, category, monthly_limit, effective_from, updated_at) "
                              f"SELECT id, user_id, category, monthly_limit, {eff}, updated_at FROM budgets_pre_5d"))
            conn.execute(text("DROP TABLE budgets_pre_5d"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_budgets_user_id ON budgets (user_id)"))
        elif old:
            conn.execute(text("ALTER TABLE budgets DROP CONSTRAINT IF EXISTS u_budget_user_category"))
        for row_id, updated in conn.execute(text("SELECT id, updated_at FROM budgets WHERE effective_from IS NULL")).all():
            conn.execute(text("UPDATE budgets SET effective_from = :m WHERE id = :i"),
                         {"m": str(updated or datetime.utcnow())[:7], "i": row_id})
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS u_budget_user_category_month "
                          "ON budgets (user_id, category, effective_from)"))


RAG_TABLES = {"documents", "document_chunks"}


def _ensure_pgvector() -> bool:
    """Postgres needs the pgvector extension before the chunk table. If the database refuses it, the app
    still starts and only document search is unavailable (SPEC-RAG)."""
    if db.engine.dialect.name != "postgresql":
        return True
    try:
        with db.engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        return True
    except Exception as e:
        logger.error("pgvector is unavailable, so document search is disabled: %s", e)
        return False


def init_db(app: Flask):
    app.config["SQLALCHEMY_DATABASE_URI"] = Config.DATABASE_URI
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["MAX_CONTENT_LENGTH"] = Config.MAX_UPLOAD_BYTES

    db.init_app(app)

    try:
        with app.app_context():
            tables = list(db.metadata.sorted_tables)
            if not _ensure_pgvector():
                tables = [t for t in tables if t.name not in RAG_TABLES]
            db.metadata.create_all(db.engine, tables=tables)
            _migrate_transaction_unique_index(app)
            _add_missing_columns()
            try:
                _migrate_budget_versions(db.engine)
            except Exception as e:
                logger.warning("Budget versions migration skipped: %s", e)
            logger.info("Database connected and tables initialized")
    except Exception as e:
        logger.warning("Could not connect to database: %s", e)
        logger.info("Database features will be unavailable")
