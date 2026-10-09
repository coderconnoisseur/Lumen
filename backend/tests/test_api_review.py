"""Review queue (SPEC-EXTRACT, EXT-03): checked invoices are auto-approved or wait for a person; only approved
invoices become transactions; every step is audit-logged and scoped to the user."""
import json

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

ALICE, BOB = "a11ce000-0000-4000-8000-000000000001", "b0b00000-0000-4000-8000-000000000002"


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


def invoice(**over):
    inv = {"vendor_name": "FreshMart Supermarket", "invoice_number": "FM-202606-002", "date": "2026-06-10",
           "items": [{"item_name": "Milk 1L", "quantity": 2, "unit_price": 60.0, "total_price": 120.0}],
           "tax_amount": 6.0, "total_amount": 126.0, "currency": "INR", "payment_method": "UPI",
           "address": "1 MG Road", "category": "Groceries", "po_number": None, "notes": None}
    inv.update(over)
    return inv


@pytest.fixture
def client(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import review
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token",
                        lambda token: jwt.decode(token, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'review.db'}")
    flask_db.metadata.create_all(engine)
    with engine.begin() as c:  # Alice has bought from FreshMart before, so it's a known vendor
        c.execute(text("INSERT INTO users (id, email) VALUES (:u, 'a@x.test')"), {"u": ALICE})
        c.execute(text("INSERT INTO transactions (id, user_id, vendor_name, invoice_number, date, total_amount) "
                       "VALUES ('t0', :u, 'FreshMart Supermarket', 'FM-202605-001', '2026-05-02', 300)"), {"u": ALICE})
    app = create_app(review.router)
    app.dependency_overrides[review.get_engine] = lambda: engine
    monkeypatch.setattr(review, "today", lambda: __import__("datetime").date(2026, 6, 30))
    c = TestClient(app)
    c.engine = engine
    return c


def _txn_count(engine, user):
    with engine.connect() as c:
        return c.execute(text("SELECT COUNT(*) FROM transactions WHERE user_id = :u"), {"u": user}).scalar()


def _audit(engine, user):
    with engine.connect() as c:
        return [r[0] for r in c.execute(text("SELECT action FROM audit_events WHERE user_id = :u ORDER BY id"),
                                        {"u": user})]


def test_a_clean_invoice_is_approved_automatically_and_becomes_a_transaction(client):
    out = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice()}).json()
    assert out["item"]["status"] == "approved" and out["item"]["confidence"] == "high"
    assert out["item"]["transaction_id"] and _txn_count(client.engine, ALICE) == 2
    assert _audit(client.engine, ALICE) == ["review_auto_approved"]


def test_a_doubtful_invoice_waits_and_creates_nothing_until_approved(client):
    out = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice(total_amount=999.0)}).json()
    item = out["item"]
    assert item["status"] == "flagged" and item["confidence"] == "low"
    assert [f["rule"] for f in item["flags"]] == ["total_mismatch"]
    assert _txn_count(client.engine, ALICE) == 1
    listed = client.get("/api/review", headers=bearer(ALICE)).json()["items"]
    assert [i["id"] for i in listed] == [item["id"]]

    # The reviewer fixes the total and approves: the checks run again on the edited invoice.
    done = client.post(f"/api/review/{item['id']}/approve", headers=bearer(ALICE),
                       json={"edits": {"total_amount": 126.0}, "note": "OCR misread the total"}).json()["item"]
    assert done["status"] == "approved" and done["flags"] == [] and done["invoice"]["total_amount"] == 126.0
    assert _txn_count(client.engine, ALICE) == 2
    assert _audit(client.engine, ALICE) == ["review_flagged", "review_approved"]
    assert client.get("/api/review", headers=bearer(ALICE)).json()["items"] == []


def test_rejecting_creates_no_transaction_and_decisions_are_final(client):
    item = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice(date="2027-01-01")}).json()["item"]
    r = client.post(f"/api/review/{item['id']}/reject", headers=bearer(ALICE), json={"note": "not ours"})
    assert r.json()["item"]["status"] == "rejected" and _txn_count(client.engine, ALICE) == 1
    assert client.post(f"/api/review/{item['id']}/approve", headers=bearer(ALICE), json={}).status_code == 409


def test_another_user_can_neither_see_nor_decide(client):
    item = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice(total_amount=999.0)}).json()["item"]
    assert client.get("/api/review", headers=bearer(BOB)).json()["items"] == []
    assert client.post(f"/api/review/{item['id']}/approve", headers=bearer(BOB), json={}).status_code == 404


def test_a_purchase_order_is_checked_from_the_database(client):
    with client.engine.begin() as c:
        c.execute(text("INSERT INTO purchase_orders (id, user_id, po_number, vendor_name, lines) VALUES "
                       "('p1', :u, 'PO-7', 'FreshMart Supermarket', :l)"),
                  {"u": ALICE, "l": json.dumps([{"item": "Milk 1L", "quantity": 5, "unit_price": 60.0}])})
    item = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice(po_number="PO-7")}).json()["item"]
    assert [f["rule"] for f in item["flags"]] == ["po_mismatch"]  # ordered 5, billed 2


def test_three_unchanged_approvals_silence_a_warning_for_that_user_only(client):
    """SPEC-FEEDBACK loop B, through the API: FreshMart prints its own reference in the PO field."""
    def send(user, n):
        return client.post("/api/review", headers=bearer(user),
                           json={"invoice": invoice(invoice_number=f"FM-REF-{n}", po_number=f"REF-{n}")}).json()["item"]

    for n in range(3):
        item = send(ALICE, n)
        assert item["status"] == "flagged" and [f["rule"] for f in item["flags"]] == ["unknown_po"]
        client.post(f"/api/review/{item['id']}/approve", headers=bearer(ALICE), json={})
    fourth = send(ALICE, 3)
    assert fourth["status"] == "approved" and fourth["flags"][0]["severity"] == "note"

    with client.engine.begin() as c:  # Bob has the same vendor history but none of Alice's approvals
        c.execute(text("INSERT INTO transactions (id, user_id, vendor_name, invoice_number, date, total_amount) "
                       "VALUES ('t9', :u, 'FreshMart Supermarket', 'FM-1', '2026-05-02', 300)"), {"u": BOB})
    assert send(BOB, 4)["status"] == "flagged"


def test_an_edited_approval_does_not_teach(client):
    for n in range(3):
        item = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice(
            invoice_number=f"FM-E-{n}", po_number=f"REF-{n}")}).json()["item"]
        client.post(f"/api/review/{item['id']}/approve", headers=bearer(ALICE),
                    json={"edits": {"payment_method": "Cash"} if n == 1 else {}})
    item = client.post("/api/review", headers=bearer(ALICE), json={"invoice": invoice(
        invoice_number="FM-E-9", po_number="REF-9")}).json()["item"]
    assert item["status"] == "flagged"  # newest approvals: 1 unchanged, then an edited one ends the streak
