"""scripts/seed_demo_data.py touches only the seeded rows and can be re-run."""
import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text


def test_seeding_keeps_the_accounts_own_rows_and_is_repeatable(monkeypatch):
    import rag.embed
    from config import Config
    from scripts import seed_demo_data

    monkeypatch.setattr(rag.embed, "FastEmbedder", rag.embed.FakeEmbedder)  # no model download in tests
    uid = str(uuid.uuid4())
    engine = create_engine(Config.DATABASE_URI)
    assert seed_demo_data.main(["--user-id", uid]) == 0  # creates tables and the users row if missing
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email = 'me@real.example' WHERE id = :u"), {"u": uid})
        conn.execute(text("INSERT INTO transactions (id, user_id, vendor_name, invoice_number, date, total_amount) "
                          "VALUES ('mine-1', :u, 'My Real Vendor', 'REAL-1', '2026-06-01', 10)"), {"u": uid})

    def counts():
        with engine.connect() as conn:
            return (conn.execute(text("SELECT COUNT(*) FROM transactions WHERE user_id = :u"), {"u": uid}).scalar(),
                    conn.execute(text("SELECT COUNT(*) FROM documents WHERE user_id = :u"), {"u": uid}).scalar(),
                    conn.execute(text("SELECT email FROM users WHERE id = :u"), {"u": uid}).scalar())

    first = counts()
    assert seed_demo_data.main(["--user-id", uid]) == 0
    assert counts() == first  # re-run: no duplicates
    assert first[0] > 200 and first[1] == 11 and first[2] == "me@real.example"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM transactions WHERE id = 'mine-1'")).scalar() == 1


TODAY = date(2026, 11, 1)


@pytest.fixture(scope="module")
def seeded(tmp_path_factory):
    """A demo account seeded as if today were 1 Nov 2026 (seeded twice: re-seeding must be a no-op)."""
    import models  # noqa: F401
    from models.database import db
    from rag.embed import FakeEmbedder
    from rag.store import ChunkStore
    from scripts.seed_demo_data import seed

    engine = create_engine(f"sqlite:///{tmp_path_factory.mktemp('seed') / 'demo.db'}")
    db.metadata.create_all(engine)
    store = ChunkStore(engine)
    uid = str(uuid.uuid4())
    counts = seed(engine, store, FakeEmbedder(), uid, today=TODAY)
    with engine.connect() as conn:
        before = conn.execute(text("SELECT COUNT(*) FROM transactions WHERE user_id = :u"), {"u": uid}).scalar()
    again = seed(engine, store, FakeEmbedder(), uid, today=TODAY)
    with engine.connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(
            text("SELECT * FROM transactions WHERE user_id = :u"), {"u": uid})]
    return engine, store, uid, counts, again, before, rows


def _d(row):
    return date.fromisoformat(row["date"])


def test_the_demo_year_ends_yesterday(seeded):
    from evals.generator.world import build_world

    engine, _, uid, counts, _, _, rows = seeded
    dates = [_d(r) for r in rows]
    assert max(dates) == TODAY - timedelta(days=1)
    assert min(dates) >= date(2025, 10, 1)  # within 13 months
    assert counts["transactions"] == len(rows)
    # One known world row: date and created_at move by the same number of days.
    world = build_world(42)
    src = next(t for t in world["transactions"] if t["invoice_number"] == "CP-202606-U10228")
    row = next(r for r in rows if r["id"] == str(uuid.uuid5(uuid.UUID(uid), src["id"])))
    shift = _d(row) - date.fromisoformat(src["date"])
    assert shift.days > 0
    created = row["created_at"] if isinstance(row["created_at"], datetime) else datetime.fromisoformat(row["created_at"])
    assert created - datetime.fromisoformat(src["created_at"]) == shift
    with engine.connect() as conn:
        issued = [date.fromisoformat(d) for (d,) in conn.execute(
            text("SELECT issue_date FROM purchase_orders WHERE user_id = :u"), {"u": uid})]
    assert issued and max(issued) < TODAY


def test_the_demo_has_a_persons_regular_bills(seeded):
    rows = seeded[-1]
    by = lambda vendor: sorted((r for r in rows if r["vendor_name"] == vendor), key=_d)
    month = lambda r: r["date"][:7]

    rent = by("Greenview Residency")
    assert len(rent) == 12 and len({month(r) for r in rent}) == 12
    assert all(r["category"] == "Housing" and r["total_amount"] == 22000 and _d(r).day <= 5 for r in rent)

    phone = by("SkyTel Mobile")
    assert len(phone) == 12 and all(r["category"] == "Utilities" for r in phone)
    assert [r["total_amount"] for r in phone] == [499] * 9 + [649] * 3

    gym = by("FitZone Gym")
    assert len(gym) == 12 and all(r["category"] == "Healthcare" and r["total_amount"] == 1500 for r in gym)

    food = by("QuickBite")
    per_month = {}
    for r in food:
        per_month.setdefault(month(r), []).append(r)
        assert r["category"] == "Restaurant" and 250 <= r["total_amount"] <= 700
    current = (TODAY - timedelta(days=1)).isoformat()[:7]
    assert len(per_month) == 12 and all(3 <= len(v) <= 6 for m, v in per_month.items() if m != current)
    # Exactly one duplicate charge this month, and it's QuickBite.
    seen = {}
    for r in rows:
        if month(r) == current:
            key = (r["vendor_name"], r["total_amount"], r["date"])
            seen[key] = seen.get(key, 0) + 1
    assert [k[0] for k, n in seen.items() if n > 1] == ["QuickBite"] and max(seen.values()) == 2

    power = by("City Power Ltd")
    earlier = sorted(r["total_amount"] for r in power[:-1])
    assert power[-1]["total_amount"] >= 1.3 * earlier[len(earlier) // 2]


def test_the_demo_has_a_rental_agreement(seeded):
    _, store, uid, counts, again, _, _ = seeded
    docs = [d for d in store.list_documents(uid) if d["title"].lower().startswith("rental agreement")]
    assert len(docs) == 1 and docs[0]["doc_type"] == "contract"
    assert counts["documents"] == again["documents"] == 11 == len(store.list_documents(uid))
    body = " ".join(f"{h} {t}" for _, title, h, t in store.user_chunks(uid) if title == docs[0]["title"])
    for fact in ("1 December 2026", "22,000", "deposit", "30 days", "5%"):
        assert fact in body, fact


def test_the_demo_account_has_a_profile_ask_lumen_can_read(seeded):
    from api.profile import profile_for

    engine, _, uid, *_ = seeded
    profile = profile_for(engine, uid)
    assert profile["monthly_income"] == 120000 and profile["monthly_budget"] == 70000
    assert "big_purchase" in profile["goals"] and profile["onboarded"] and profile["currency"] == "INR"


def test_reseeding_the_same_day_adds_nothing(seeded):
    _, _, _, counts, again, before, rows = seeded
    assert counts == again and before == len(rows)
