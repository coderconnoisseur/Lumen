import logging

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
    "review_items": [("extracted", "TEXT")],  # SPEC-FEEDBACK
    "transactions": [("currency", "VARCHAR(3)"), ("po_number", "VARCHAR")],  # EXT-01
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
            logger.info("Database connected and tables initialized")
    except Exception as e:
        logger.warning("Could not connect to database: %s", e)
        logger.info("Database features will be unavailable")
