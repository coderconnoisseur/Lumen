"""SPEC-EMAIL-INGEST: saving parsed money emails with Message-ID and cross-source dedup."""
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import models  # noqa: F401
from inbox import save
from inbox.parse import ParsedEmail
from models import Transaction
from models.database import db

USER, OTHER = "7a1c0000-0000-4000-8000-000000000001", "7a1c0000-0000-4000-8000-000000000002"


@pytest.fixture
def session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'i.db'}")
    db.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def mail(**kw):
    base = dict(is_transaction=True, direction="debit", amount=499.0, currency="INR", merchant="SWIGGY ORDER",
                date="2026-10-10", kind="receipt")
    return ParsedEmail(**{**base, **kw})


def rows(s):
    return list(s.scalars(select(Transaction)))


def test_debit_is_imported_then_duplicate(session):
    assert save.save_email_transaction(session, USER, mail(), "<a@x>", default_currency="USD") == "imported"
    session.commit()
    t, = rows(session)
    assert (t.source, t.currency, t.total_amount, t.date) == ("email", "INR", 499.0, "2026-10-10")
    assert t.vendor_name and t.category and t.import_key
    assert save.save_email_transaction(session, USER, mail(), "<a@x>", default_currency="USD") == "duplicate"
    assert len(rows(session)) == 1


def test_default_currency_and_subscription_category(session):
    save.save_email_transaction(session, USER, mail(currency=None, kind="subscription", merchant="Netflix"),
                                "<b@x>", default_currency="USD")
    t, = rows(session)
    assert (t.currency, t.category) == ("USD", "Subscriptions")


def test_credit_and_non_transaction_save_nothing(session):
    assert save.save_email_transaction(session, USER, mail(direction="credit"), "<c@x>", default_currency="INR") == "credit"
    assert save.save_email_transaction(session, USER, mail(is_transaction=False), "<d@x>",
                                       default_currency="INR") == "not_transaction"
    assert rows(session) == []


def test_matches_existing_statement_row_of_any_source(session):
    from api.profile import ensure_user
    ensure_user(session, USER, None)
    ensure_user(session, OTHER, None)
    session.add(Transaction(user_id=USER, vendor_name="Swiggy", date="2026-10-12", total_amount=499.0,
                            source="statement", import_key="k"))
    session.add(Transaction(user_id=OTHER, vendor_name="Zomato", date="2026-10-10", total_amount=120.0))
    session.commit()
    assert save.save_email_transaction(session, USER, mail(), "<e@x>", default_currency="INR") == "matched"
    # another user's identical row is not a match
    assert save.save_email_transaction(session, USER, mail(merchant="Zomato", amount=120.0), "<f@x>",
                                       default_currency="INR") == "imported"


def test_mark_processed_twice_is_safe(session):
    assert not save.already_processed(session, USER, "<g@x>")
    save.mark_processed(session, USER, "<g@x>")
    save.mark_processed(session, USER, "<g@x>")
    session.commit()
    assert save.already_processed(session, USER, "<g@x>")
    assert not save.already_processed(session, OTHER, "<g@x>")
