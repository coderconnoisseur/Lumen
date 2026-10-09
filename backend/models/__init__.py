import uuid
from datetime import datetime
from sqlalchemy import String, Text, Integer, Float, DateTime, ForeignKey, Boolean, LargeBinary
from sqlalchemy.types import TypeDecorator
from models.database import db
import json


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = db.Column(db.String, unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Receipt(db.Model):
    __tablename__ = "receipts"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), db.ForeignKey("users.id"), nullable=False)

    file_url = db.Column(db.String, nullable=False)
    raw_text = db.Column(db.Text, nullable=True)
    file_type = db.Column(db.String, nullable=True)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship("User")


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), db.ForeignKey("users.id"), nullable=False)
    receipt_id = db.Column(String(36), db.ForeignKey("receipts.id"), nullable=True)

    vendor_name = db.Column(db.String, nullable=True)
    invoice_number = db.Column(db.String, nullable=True)
    date = db.Column(db.String, nullable=True)

    total_amount = db.Column(db.Float, nullable=True)
    tax_amount = db.Column(db.Float, nullable=True)
    payment_method = db.Column(db.String, nullable=True)

    address = db.Column(db.String, nullable=True)
    category = db.Column(db.String, nullable=True)
    currency = db.Column(db.String(3), nullable=True)  # as printed (ISO code), never converted; NULL = old rows
    po_number = db.Column(db.String, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint(
            "user_id", "vendor_name", "invoice_number", name="u_user_vendor_invoice"
        ),
    )

    items = db.relationship("TransactionItem", backref="transaction")
    fraud_anomalies = db.relationship("FraudAnomaly", backref="transaction")


class TransactionItem(db.Model):
    __tablename__ = "transaction_items"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = db.Column(String(36), db.ForeignKey("transactions.id"), nullable=False)

    item_name = db.Column(db.String, nullable=False)
    quantity = db.Column(db.Integer, default=1)
    unit_price = db.Column(db.Float, nullable=True)
    total_price = db.Column(db.Float, nullable=True)


class FraudAnomaly(db.Model):
    """Fraud / spending anomalies detected by the AI analytics pipeline."""
    __tablename__ = "anomalies"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = db.Column(String(36), db.ForeignKey("transactions.id"), nullable=False)
    user_id = db.Column(String(36), nullable=True)
    anomaly_type = db.Column(db.String(50))
    detection_method = db.Column(db.String(50))
    risk_score = db.Column(db.Integer, nullable=False)
    risk_level = db.Column(db.String(20))
    explanation = db.Column(db.Text)
    flags = db.Column(db.Text)
    llm_explanation = db.Column(db.Text)
    recommendation = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class AnalyticsInsight(db.Model):
    """Actionable insights shown on the AI analytics dashboard."""
    __tablename__ = "insights"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(String(36), nullable=False, index=True)
    insight_type = db.Column(db.String(50), nullable=False)
    title = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text, nullable=False)
    severity = db.Column(db.String(20))
    meta = db.Column("metadata", db.Text)
    confidence_score = db.Column(db.Float)
    is_actionable = db.Column(db.Boolean, default=False)
    action_taken = db.Column(db.Boolean, default=False)
    is_read = db.Column(db.Boolean, default=False)
    expires_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class SpendingPattern(db.Model):
    """Recurring spending patterns detected per user."""
    __tablename__ = "spending_patterns"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(String(36), nullable=False, index=True)
    pattern_type = db.Column(db.String(50))
    vendor_name = db.Column(db.String(255))
    category = db.Column(db.String(100))
    frequency_days = db.Column(db.Integer)
    average_amount = db.Column(db.Float)
    amount_variance = db.Column(db.Float)
    last_occurrence = db.Column(db.String)
    next_predicted_date = db.Column(db.String)
    confidence_score = db.Column(db.Float)
    occurrence_count = db.Column(db.Integer)
    is_active = db.Column(db.Boolean, default=True)
    meta = db.Column("metadata", db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ChatMessage(db.Model):
    """Persisted chat history per user."""
    __tablename__ = "chat_messages"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


# Legacy alias — some imports may still reference Insight / Anomaly
Insight = AnalyticsInsight
Anomaly = FraudAnomaly


class EmailConfig(db.Model):
    """Email configuration for automated invoice polling"""
    __tablename__ = "email_configs"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), db.ForeignKey("users.id"), nullable=False, unique=True)
    
    # Email settings
    email_address = db.Column(db.String, nullable=False)
    provider = db.Column(db.String, default="gmail")  # gmail, outlook, yahoo, custom
    
    # IMAP settings
    imap_server = db.Column(db.String, nullable=False)
    imap_port = db.Column(Integer, default=993)
    imap_username = db.Column(db.String, nullable=True)
    imap_password = db.Column(db.String, nullable=True)  # Encrypted in production
    use_ssl = db.Column(db.Boolean, default=True)
    
    # OAuth settings (for Gmail OAuth)
    oauth_token = db.Column(Text, nullable=True)  # JSON stored as text
    oauth_refresh_token = db.Column(db.String, nullable=True)
    oauth_token_expiry = db.Column(db.DateTime, nullable=True)
    
    # Polling settings
    polling_enabled = db.Column(db.Boolean, default=True)
    polling_interval_minutes = db.Column(Integer, default=5)
    folder_to_watch = db.Column(db.String, default="INBOX")
    mark_as_read = db.Column(db.Boolean, default=True)
    
    # Status tracking
    last_poll_time = db.Column(db.DateTime, nullable=True)
    last_successful_poll = db.Column(db.DateTime, nullable=True)
    last_error = db.Column(Text, nullable=True)
    emails_processed = db.Column(Integer, default=0)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = db.relationship("User")


class EmbeddingVector(TypeDecorator):
    """A 384-d embedding: pgvector's `vector` on Postgres (searched in SQL), float32 bytes elsewhere
    (searched with numpy). Both are exact, so SQLite evals and Postgres agree (SPEC-RAG)."""

    impl = LargeBinary
    cache_ok = True
    dim = 384

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from pgvector.sqlalchemy import Vector

            return dialect.type_descriptor(Vector(self.dim))
        return dialect.type_descriptor(LargeBinary())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        import numpy as np

        array = np.asarray(value, dtype=np.float32)
        return array if dialect.name == "postgresql" else array.tobytes()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        import numpy as np

        if dialect.name == "postgresql":
            return np.asarray(value, dtype=np.float32)
        return np.frombuffer(value, dtype=np.float32)


class Document(db.Model):
    """An uploaded document indexed for retrieval (SPEC-RAG). One per (user, content): re-uploads are no-ops."""

    __tablename__ = "documents"

    id = db.Column(db.String(100), primary_key=True)
    user_id = db.Column(String(36), nullable=False, index=True)
    title = db.Column(db.String, nullable=False)
    doc_type = db.Column(db.String(32), nullable=False, default="other")
    filename = db.Column(db.String, nullable=True)
    content_hash = db.Column(db.String(64), nullable=False)
    embedding_model = db.Column(db.String(100), nullable=False)
    chunk_count = db.Column(Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint("user_id", "content_hash", name="u_document_user_content"),)


class DocumentChunk(db.Model):
    """A section-aligned piece of a document, with its embedding (`<doc id>#sNN[-k]`)."""

    __tablename__ = "document_chunks"

    id = db.Column(db.String(120), primary_key=True)
    document_id = db.Column(db.String(100), db.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = db.Column(String(36), nullable=False, index=True)  # copied from the document: the tenant filter
    section_no = db.Column(Integer, nullable=False)
    piece_no = db.Column(Integer, nullable=False, default=0)
    heading = db.Column(db.String, nullable=True)
    text = db.Column(Text, nullable=False)
    content_hash = db.Column(db.String(64), nullable=False)
    embedding = db.Column(EmbeddingVector, nullable=False)
    embedding_model = db.Column(db.String(100), nullable=False)


class Proposal(db.Model):
    """An action the agent proposes; nothing changes until a human approves it (SPEC-AGENT)."""

    __tablename__ = "proposals"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), nullable=False, index=True)
    type = db.Column(db.String(50), nullable=False)  # e.g. flag_invoice, mark_paid, update_category
    target = db.Column(db.String(200), nullable=False)  # what it acts on, e.g. an invoice number
    payload = db.Column(Text, nullable=False, default="{}")  # JSON
    risk = db.Column(db.String(10), nullable=False)  # low | medium | high
    reason = db.Column(Text, nullable=False)
    evidence = db.Column(Text, nullable=False, default="[]")  # JSON list of citations / SQL
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending | approved | rejected
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    decided_at = db.Column(db.DateTime, nullable=True)


class AuditEvent(db.Model):
    """Append-only log of proposals and decisions (who, what, when)."""

    __tablename__ = "audit_events"

    id = db.Column(Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(String(36), nullable=False, index=True)
    actor = db.Column(db.String(20), nullable=False)  # agent | user
    action = db.Column(db.String(50), nullable=False)  # proposal_created | proposal_approved | ...
    proposal_id = db.Column(String(36), nullable=True, index=True)
    detail = db.Column(Text, nullable=True)  # JSON
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class PurchaseOrder(db.Model):
    """A purchase order the user issued; invoices that cite it are checked against it (SPEC-EXTRACT)."""

    __tablename__ = "purchase_orders"
    __table_args__ = (db.UniqueConstraint("user_id", "po_number", name="uq_purchase_orders_user_po"),)

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), nullable=False, index=True)
    po_number = db.Column(db.String(100), nullable=False)
    vendor_name = db.Column(db.String, nullable=False)
    issue_date = db.Column(db.String(10), nullable=True)  # 'YYYY-MM-DD', like transactions.date
    lines = db.Column(Text, nullable=False, default="[]")  # JSON [{item, quantity, unit_price}]
    currency = db.Column(db.String(3), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ReviewItem(db.Model):
    """An extracted invoice and its checks. High confidence is approved automatically; the rest wait here for a
    person. Only approved invoices become transactions (SPEC-EXTRACT, EXT-03)."""

    __tablename__ = "review_items"

    id = db.Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(String(36), nullable=False, index=True)
    invoice = db.Column(Text, nullable=False)  # JSON, the extracted (or edited) invoice
    extracted = db.Column(Text, nullable=True)  # JSON, what the reader produced; differs from `invoice` if edited
    flags = db.Column(Text, nullable=False, default="[]")  # JSON [{rule, severity, detail}]
    confidence = db.Column(db.String(10), nullable=False)  # high | medium | low
    status = db.Column(db.String(20), nullable=False)  # flagged | approved | rejected
    transaction_id = db.Column(String(36), nullable=True)
    note = db.Column(Text, nullable=True)  # the reviewer's reason
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    decided_at = db.Column(db.DateTime, nullable=True)
