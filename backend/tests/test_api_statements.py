"""SPEC-STATEMENTS: preview and import API."""
import json

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

USER = "7a1c0000-0000-4000-8000-000000000001"
OTHER = "7a1c0000-0000-4000-8000-000000000002"
CARD = (b"Transaction Date,Description,Amount\n2026-10-03,AMAZON.IN MARKETPLACE,-2499.00\n"
        b"2026-10-04,PAYMENT RECEIVED - THANK YOU,15000.00\n2026-10-06,UBER *TRIP,-312.40\n")


def bearer(sub, anonymous=False, email="me@example.com"):
    claims = {"sub": sub, "is_anonymous": anonymous, "email": email}
    return {"Authorization": "Bearer " + jwt.encode(claims, "k" * 32, algorithm="HS256")}


@pytest.fixture
def client(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import statements
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    engine = create_engine(f"sqlite:///{tmp_path / 's.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(statements.router)
    app.dependency_overrides[statements.get_engine] = lambda: engine
    limiter.reset()
    return TestClient(app), engine


def post(c, path, data=CARD, who=USER, **form):
    return c.post(f"/api/statements/{path}", headers=bearer(who), files={"file": ("s.csv", data)}, data=form)


def rows(engine, sql="SELECT vendor_name, total_amount, category, currency, source FROM transactions "
                     "WHERE source = 'statement' ORDER BY date"):
    with engine.connect() as conn:
        return conn.execute(text(sql)).all()


def add_invoice(engine, user, vendor="Amazon", amount=2499.0, date="2026-10-05"):
    with engine.begin() as conn:
        conn.execute(text("INSERT OR IGNORE INTO users (id, email) VALUES (:u, :e)"), {"u": user, "e": f"{user}@x"})
        conn.execute(text("INSERT INTO transactions (id, user_id, vendor_name, total_amount, date) "
                          "VALUES (:i, :u, :v, :a, :d)"),
                     {"i": f"t-{user}", "u": user, "v": vendor, "a": amount, "d": date})


def test_preview_returns_mapping_and_counts(client):
    c, _ = client
    r = post(c, "preview")
    b = r.json()
    assert r.status_code == 200 and b["success"] and b["header_line"] == 1
    assert b["columns"] == ["Transaction Date", "Description", "Amount"]
    assert b["mapping"]["date"] == 0 and b["mapping"]["amount"] == 2
    assert b["counts"] == {"rows": 3, "debits": 2, "credits": 1, "unreadable": 0}
    assert len(b["sample"]) == 3 and b["sample"][0]["description"] == "AMAZON.IN MARKETPLACE"


def test_import_inserts_debits_only(client):
    c, engine = client
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email, currency) VALUES (:u, 'me@example.com', 'CHF')"), {"u": USER})
    b = post(c, "import", mapping=json.dumps(post(c, "preview").json()["mapping"])).json()
    assert (b["imported"], b["credits"], b["duplicates"], b["matched"], b["unreadable"]) == (2, 1, 0, 0, [])
    assert rows(engine) == [("Amazon.in Marketplace", 2499.0, "Shopping", "CHF", "statement"),
                            ("Uber Trip", 312.4, "Transport", "CHF", "statement")]


def test_form_currency_wins_and_default_used_without_profile(client):
    c, engine = client
    m = json.dumps(post(c, "preview").json()["mapping"])
    post(c, "import", mapping=m, currency="EUR")
    assert {r[3] for r in rows(engine)} == {"EUR"}
    post(c, "import", who=OTHER, mapping=m)
    from config import Config
    assert {r[0] for r in rows(engine, "SELECT currency FROM transactions WHERE user_id = '%s'" % OTHER)} \
        == {Config.DEFAULT_CURRENCY}


def test_reimport_imports_nothing(client):
    c, engine = client
    m = json.dumps(post(c, "preview").json()["mapping"])
    post(c, "import", mapping=m)
    b = post(c, "import", mapping=m).json()
    assert (b["imported"], b["duplicates"], b["credits"]) == (0, 2, 1)
    assert len(rows(engine)) == 2


def test_invoice_match_is_not_imported_and_stays_matched_on_reimport(client):
    c, engine = client
    add_invoice(engine, USER)
    m = json.dumps(post(c, "preview").json()["mapping"])
    b = post(c, "import", mapping=m).json()
    assert (b["imported"], b["matched"], b["duplicates"]) == (1, 1, 0)
    b = post(c, "import", mapping=m).json()
    assert (b["imported"], b["matched"], b["duplicates"]) == (0, 1, 1)


def test_another_users_invoice_does_not_match(client):
    c, engine = client
    add_invoice(engine, OTHER)
    b = post(c, "import", mapping=json.dumps(post(c, "preview").json()["mapping"])).json()
    assert (b["imported"], b["matched"]) == (2, 0)


def test_no_header_is_400_with_raw_rows(client):
    c, _ = client
    r = post(c, "preview", b"hello,world\n1,2\n")
    assert r.status_code == 400 and r.json()["detail"]["raw"][0] == ["hello", "world"]
    assert post(c, "import", b"hello,world\n1,2\n", mapping="{}").status_code == 400


def test_binary_is_400_and_big_is_413(client):
    c, _ = client
    assert post(c, "preview", b"\x89PNG\r\n\x1a\n\x00\x00\x00").status_code == 400
    assert post(c, "preview", b"a" * (5 * 1024 * 1024 + 1)).status_code == 413


def test_mapping_override_is_honoured(client):
    c, engine = client
    data = b"Date,Amount,Description,Note\n2026-10-03,-50.00,IGNORED,NETFLIX.COM\n"
    m = post(c, "preview", data).json()["mapping"]
    assert m["description"] == 2
    m["description"] = 3
    post(c, "import", data, mapping=json.dumps(m))
    assert rows(engine)[0][0] == "Netflix.com"


def test_unreadable_lines_are_reported(client):
    c, _ = client
    data = b"Date,Description,Amount\nnot a date,X,-5\n2026-10-03,Y,-5\n"
    m = json.dumps(post(c, "preview", data).json()["mapping"])
    b = post(c, "import", data, mapping=m).json()
    assert b["imported"] == 1 and b["unreadable"] == [2]


@pytest.mark.parametrize("bad", ["[]", "null", "5", "not json", '{"date": 99}', '{"date": true}', '{"date": -1}',
                                 '{"bogus": 0}', '{"date": "0"}'])
def test_invalid_mapping_is_400(client, bad):
    c, _ = client
    assert post(c, "import", mapping=bad).status_code == 400


def test_zero_amount_line_is_unreadable(client):
    c, engine = client
    data = b"Date,Description,Amount\n2026-10-03,FREE THING,0.00\n2026-10-04,Y,-5\n"
    m = json.dumps(post(c, "preview", data).json()["mapping"])
    b = post(c, "import", data, mapping=m).json()
    assert (b["imported"], b["credits"], b["unreadable"]) == (1, 0, [2])


def test_one_invoice_matches_only_one_line(client):
    c, engine = client
    add_invoice(engine, USER)
    data = (b"Date,Description,Amount\n2026-10-03,AMAZON.IN MARKETPLACE,-2499.00\n"
            b"2026-10-04,AMAZON.IN MARKETPLACE,-2499.00\n")
    m = json.dumps(post(c, "preview", data).json()["mapping"])
    b = post(c, "import", data, mapping=m).json()
    assert (b["matched"], b["imported"]) == (1, 1)


def test_non_iso_invoice_date_does_not_crash_and_time_suffix_matches(client):
    c, engine = client
    add_invoice(engine, USER, date="13/10/2026")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO transactions (id, user_id, vendor_name, total_amount, date) "
                          "VALUES ('t2', :u, 'Uber', 312.4, '2026-10-09T10:00:00')"), {"u": USER})
    m = json.dumps(post(c, "preview").json()["mapping"])
    b = post(c, "import", mapping=m).json()
    assert (b["imported"], b["matched"]) == (1, 1)  # Amazon imported, Uber matched on the boundary day


def test_header_line_override(client):
    c, engine = client
    data = b"junk,row\nDate,Description,Amount\n2026-10-03,Y,-5\n"
    m = json.dumps({"date": 0, "description": 1, "amount": 2})
    b = post(c, "import", data, mapping=m, header_line="2").json()
    assert b["imported"] == 1


def test_unclosed_quote_payload_is_400(client):
    c, _ = client
    assert post(c, "preview", b'Date,Amount\n"' + b"a" * 200000).status_code == 400


def test_bad_currency_is_400(client):
    c, _ = client
    m = json.dumps({"date": 0, "description": 1, "amount": 2})
    assert post(c, "import", mapping=m, currency="RUPEES").status_code == 400
