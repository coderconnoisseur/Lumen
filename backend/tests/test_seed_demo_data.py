"""scripts/seed_demo_data.py touches only the seeded rows and can be re-run."""
import uuid

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
    assert first[0] > 200 and first[1] == 10 and first[2] == "me@real.example"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM transactions WHERE id = 'mine-1'")).scalar() == 1
