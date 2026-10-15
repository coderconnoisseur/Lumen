"""SPEC-EMAIL-INGEST: the poller reads money emails' bodies, dedups by Message-ID, never stops on one failure."""
import pytest

from inbox.parse import ParsedEmail
from tests.test_invoice_upload import client  # noqa: F401  (fixture: empty db)
from utils.llm import LLMError

U1, U2 = "7a1c0000-0000-4000-8000-0000000000a1", "7a1c0000-0000-4000-8000-0000000000a2"


def mail(mid, subject="Alert", text="Rs 499 debited at NETFLIX", **kw):
    base = dict(id=mid, message_id=mid, subject=subject, **{"from": "bank@x.com"}, date="Sat, 10 Oct 2026 10:00:00 +0000",
                text=text, attachments=[], has_invoice_attachment=False)
    return {**base, **kw}


def parsed(**kw):
    base = dict(is_transaction=True, direction="debit", amount=499.0, currency="INR", merchant="NETFLIX",
                date="2026-10-10", kind="alert")
    return ParsedEmail(**{**base, **kw})


class Fake:
    """Stands in for EmailService: no IMAP."""
    def __init__(self, emails, fail=False):
        self.emails, self.fail, self.since = emails, fail, None

    def connect(self):
        if self.fail:
            raise RuntimeError("login failed")

    def fetch_new_emails(self, since):
        self.since = since
        return self.emails

    def mark_as_read(self, _id):
        pass

    def disconnect(self):
        pass


@pytest.fixture
def env(client, monkeypatch):  # noqa: F811
    from app import app
    from types import SimpleNamespace
    from models import EmailConfig, ProcessedEmail, User
    from models.database import db
    from utils import email_poller

    services = {}
    monkeypatch.setattr(email_poller, "EmailService", lambda cfg: services[cfg.user_id])
    ctx = app.app_context()
    ctx.push()
    ProcessedEmail.query.delete()
    EmailConfig.query.delete()
    for uid in (U1, U2):
        db.session.add(User(id=uid, email=f"{uid}@t.com"))
        db.session.add(EmailConfig(user_id=uid, email_address=f"{uid}@t.com", imap_server="x", mark_as_read=False))
    db.session.commit()

    yield SimpleNamespace(poller=email_poller, db=db, services_=services,
                          config=lambda uid: EmailConfig.query.filter_by(user_id=uid).first())
    ctx.pop()


def txns():
    from models import Transaction
    return Transaction.query.all()


def test_debit_saved_promo_skipped_and_repoll_is_idempotent(env, monkeypatch):
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: parsed())
    env.services_[U1] = Fake([mail("<a>"), mail("<p>", subject="Big sale", text="20% off everything")])
    r = env.poller.process_user_emails(env.config(U1))
    assert (r["transactions_added"], r["skipped"]) == (1, 1)
    r2 = env.poller.process_user_emails(env.config(U1))
    assert r2["transactions_added"] == 0 and len(txns()) == 1
    from models import ProcessedEmail
    assert ProcessedEmail.query.count() == 2


def test_first_run_backfills_30_days_then_since_last_poll(env, monkeypatch):
    from datetime import datetime, timedelta
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: parsed())
    fake = env.services_[U1] = Fake([])
    env.poller.process_user_emails(env.config(U1))
    assert timedelta(days=29) < datetime.utcnow() - fake.since < timedelta(days=31)
    first = env.config(U1).last_poll_time
    env.poller.process_user_emails(env.config(U1))
    assert fake.since == first - timedelta(days=2)


def test_invoice_attachment_goes_to_invoice_path_and_is_marked(env, monkeypatch):
    calls = []
    monkeypatch.setattr(env.poller, "process_invoice_attachment",
                        lambda content, fn, uid, data: calls.append(fn) or {"success": True})
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: pytest.fail("body parsed"))
    env.services_[U1] = Fake([mail("<i>", attachments=[{"filename": "a.pdf", "content": b"x"}],
                                   has_invoice_attachment=True)])
    r = env.poller.process_user_emails(env.config(U1))
    assert calls == ["a.pdf"] and r["invoices_created"] == 1
    env.poller.process_user_emails(env.config(U1))
    assert calls == ["a.pdf"]  # marked processed -> not redone


def test_bank_alert_then_receipt_for_same_charge_is_one_transaction(env, monkeypatch):
    replies = iter([parsed(), parsed(kind="receipt", merchant="Netflix")])
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: next(replies))
    env.services_[U1] = Fake([mail("<alert>"), mail("<receipt>", subject="Your Netflix receipt")])
    r = env.poller.process_user_emails(env.config(U1))
    assert (r["transactions_added"], r["duplicates"]) == (1, 1)  # "matched" counts as a duplicate
    assert len(txns()) == 1


def test_undated_or_unreadable_date_uses_email_date_header(env, monkeypatch):
    replies = iter([parsed(date=None), parsed(date="soon", amount=50.0, merchant="Uber")])
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: next(replies))
    env.services_[U1] = Fake([mail("<n>", date="Wed, 07 Oct 2026 08:00:00 +0000"),
                              mail("<u>", date="Thu, 08 Oct 2026 08:00:00 +0000")])
    env.poller.process_user_emails(env.config(U1))
    assert sorted(t.date for t in txns()) == ["2026-10-07", "2026-10-08"]


def test_llm_outage_leaves_email_unprocessed_and_continues(env, monkeypatch):
    def parse(subject, *a, **k):
        if subject == "Down":
            raise LLMError(LLMError.UNAVAILABLE, "outage")
        return parsed()
    monkeypatch.setattr(env.poller, "parse_money_email", parse)
    env.services_[U1] = Fake([mail("<d>", subject="Down"), mail("<ok>", subject="Alert")])
    r = env.poller.process_user_emails(env.config(U1))
    assert r["success"] and r["transactions_added"] == 1
    from models import ProcessedEmail
    assert [p.message_id for p in ProcessedEmail.query.all()] == ["<ok>"]


def test_default_currency_is_users_then_config(env, monkeypatch):
    from models import User
    env.db.session.get(User, U1).currency = "EUR"
    env.db.session.commit()
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: parsed(currency=None))
    env.services_[U1] = Fake([mail("<c>")])
    env.poller.process_user_emails(env.config(U1))
    assert txns()[0].currency == "EUR"


def test_one_users_failure_sets_last_error_and_loop_continues(env, monkeypatch):
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: parsed())
    env.services_[U1] = Fake([], fail=True)
    env.services_[U2] = Fake([mail("<z>")])
    results = env.poller.poll_all_users()
    assert len(results) == 2
    assert "login failed" in env.config(U1).last_error
    assert len(txns()) == 1


def test_lifespan_starts_scheduler_only_when_enabled(monkeypatch):
    import asyncio
    import asgi
    from utils.scheduler import scheduler

    started = []
    monkeypatch.setattr(scheduler, "start", lambda app=None, interval_seconds=None: started.append((app, interval_seconds)))
    monkeypatch.setattr(asgi.flask_module, "startup_checks", lambda: None)

    async def run():
        async with asgi._lifespan(None):
            pass

    monkeypatch.delenv("EMAIL_POLLING", raising=False)
    asyncio.run(run())
    assert started == []
    monkeypatch.setenv("EMAIL_POLLING", "1")
    asyncio.run(run())
    assert started == [(asgi.flask_app, 600)]


def test_retry_keeps_last_poll_time_and_rescans_two_days_back(env, monkeypatch):
    from datetime import datetime, timedelta
    cfg = env.config(U1)
    old = cfg.last_poll_time = datetime.utcnow() - timedelta(days=3)
    env.db.session.commit()
    state = {"down": True}

    def parse(*a, **k):
        if state["down"]:
            raise LLMError(LLMError.UNAVAILABLE, "outage")
        return parsed()
    monkeypatch.setattr(env.poller, "parse_money_email", parse)
    fake = env.services_[U1] = Fake([mail("<d>")])
    env.poller.process_user_emails(env.config(U1))
    assert env.config(U1).last_poll_time == old
    assert fake.since <= old - timedelta(days=2)
    state["down"] = False
    r = env.poller.process_user_emails(env.config(U1))
    assert r["transactions_added"] == 1
    assert env.config(U1).last_poll_time > old


def test_llm_outage_on_invoice_attachment_leaves_email_for_retry(env, monkeypatch):
    def down(*a, **k):
        raise LLMError(LLMError.UNAVAILABLE, "outage")
    monkeypatch.setattr(env.poller, "read_with_feedback", down)
    env.services_[U1] = Fake([mail("<i>", attachments=[{"filename": "a.png", "content": b"x"}],
                                   has_invoice_attachment=True)])
    r = env.poller.process_user_emails(env.config(U1))
    assert r["success"] and r["invoices_created"] == 0
    from models import ProcessedEmail
    assert ProcessedEmail.query.count() == 0
    assert env.config(U1).last_poll_time is None  # retry pins the window


def test_already_saved_attachment_is_not_resubmitted(env, monkeypatch):
    from models import Transaction
    from utils.files import invoice_key
    env.db.session.add(Transaction(id="t1", user_id=U1, vendor_name="V", date="2026-10-01", total_amount=5,
                                   file_key=invoice_key(U1, b"saved", "pdf")))
    env.db.session.commit()
    calls = []
    monkeypatch.setattr(env.poller, "process_invoice_attachment",
                        lambda content, fn, uid, data: calls.append(fn) or {"success": True})
    env.services_[U1] = Fake([mail("<i>", has_invoice_attachment=True, attachments=[
        {"filename": "a.pdf", "content": b"saved"}, {"filename": "b.pdf", "content": b"new"}])])
    env.poller.process_user_emails(env.config(U1))
    assert calls == ["b.pdf"]


def test_failed_poll_keeps_last_poll_time(env):
    from datetime import datetime, timedelta
    old = env.config(U1).last_poll_time = datetime.utcnow() - timedelta(days=5)
    env.db.session.commit()
    env.services_[U1] = Fake([], fail=True)
    assert env.poller.process_user_emails(env.config(U1))["success"] is False
    assert env.config(U1).last_poll_time == old


def test_save_error_on_one_email_does_not_abort_batch(env, monkeypatch):
    from datetime import datetime, timedelta
    cfg = env.config(U1)
    old = cfg.last_poll_time = datetime.utcnow() - timedelta(days=1)
    env.db.session.commit()
    real = env.poller.save_email_transaction

    def save(session, uid, p, mid, **k):
        if mid == "<bad>":
            raise RuntimeError("db hiccup")
        return real(session, uid, p, mid, **k)
    monkeypatch.setattr(env.poller, "save_email_transaction", save)
    monkeypatch.setattr(env.poller, "parse_money_email", lambda *a, **k: parsed())
    env.services_[U1] = Fake([mail("<bad>"), mail("<ok>")])
    r = env.poller.process_user_emails(env.config(U1))
    assert r["success"] and r["transactions_added"] == 1
    from models import ProcessedEmail
    assert [p.message_id for p in ProcessedEmail.query.all()] == ["<ok>"]
    assert env.config(U1).last_poll_time == old
