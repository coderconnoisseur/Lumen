"""EVAL-02: the seeded synthetic world and its database loader (SPEC-EVAL, "Data")."""
import uuid

import pytest
from sqlalchemy import create_engine, text


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(seed=42)


def test_same_seed_same_world_and_different_seed_differs(world):
    from evals.generator.world import build_world

    assert build_world(seed=42) == world
    assert build_world(seed=7) != world


def test_users_have_stable_uuids_the_sql_agent_accepts(world):
    from ai.sql_agent import _is_valid_user_id

    keys = [u["key"] for u in world["users"]]
    assert len(keys) >= 2 and keys[:2] == ["u1", "u2"]
    for user in world["users"]:
        assert _is_valid_user_id(user["id"])
        assert uuid.UUID(user["id"]) == uuid.uuid5(uuid.NAMESPACE_URL, f"https://lumen.test/eval/{user['key']}")


def test_transactions_are_consistent(world):
    from evals.generator.world import AS_OF, START

    txns = world["transactions"]
    assert len(txns) >= 200
    assert len({t["id"] for t in txns}) == len(txns)
    items_by_txn = {}
    for item in world["transaction_items"]:
        items_by_txn.setdefault(item["transaction_id"], []).append(item)
        assert item["total_price"] == round(item["quantity"] * item["unit_price"], 2)
    for t in txns:
        assert START.isoformat() <= t["date"] <= AS_OF.isoformat()
        items = items_by_txn[t["id"]]
        subtotal = round(sum(i["total_price"] for i in items), 2)
        assert t["total_amount"] == round(subtotal + t["tax_amount"], 2)
        assert t["category"] in {
            "Groceries", "Restaurant", "Utilities", "Transport", "Healthcare", "Shopping", "Entertainment", "Other",
        }


def test_each_user_has_monthly_bills_and_a_vendor_of_their_own(world):
    by_user = {}
    for t in world["transactions"]:
        by_user.setdefault(t["user_id"], []).append(t)
    vendor_sets = []
    for user in world["users"][:2]:
        txns = by_user[user["id"]]
        utility_months = {t["date"][:7] for t in txns if t["category"] == "Utilities"}
        assert len(utility_months) == 12
        vendor_sets.append({t["vendor_name"] for t in txns})
    # Tenant-isolation cases need vendors only one user has bought from.
    assert vendor_sets[0] - vendor_sets[1] and vendor_sets[1] - vendor_sets[0]


def test_purchase_orders_point_at_known_vendors(world):
    vendors = {v["name"] for v in world["vendors"]}
    pos = world["purchase_orders"]
    assert len(pos) >= 10
    for po in pos:
        assert po["vendor_name"] in vendors
        assert po["total"] == round(sum(round(l["quantity"] * l["unit_price"], 2) for l in po["lines"]), 2)


def test_loader_writes_the_world_to_sqlite(world, tmp_path):
    from evals.generator.db import load_world

    engine = create_engine(f"sqlite:///{tmp_path / 'eval.db'}")
    load_world(engine, world)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM transactions")).scalar() == len(world["transactions"])
        assert conn.execute(text("SELECT COUNT(*) FROM transaction_items")).scalar() == len(
            world["transaction_items"]
        )
        u1 = world["users"][0]["id"]
        total = conn.execute(
            text("SELECT SUM(total_amount) FROM transactions WHERE user_id = :u"), {"u": u1}
        ).scalar()
    expected = sum(t["total_amount"] for t in world["transactions"] if t["user_id"] == u1)
    assert round(total, 2) == round(expected, 2)

    load_world(engine, world)  # idempotent: replaces, never duplicates
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM transactions")).scalar() == len(world["transactions"])
