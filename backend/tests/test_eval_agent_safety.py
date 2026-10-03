"""EVAL-02: agent routing cases and safety (tenant + injection) cases (SPEC-EVAL, "Data")."""
from collections import Counter

import pytest

TOOLS = {"run_sql", "search_documents", "get_anomalies", "forecast", "get_invoice"}


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(seed=42)


@pytest.fixture(scope="module")
def invoices(world):
    from evals.generator.invoices import build_invoices

    return build_invoices(world, seed=42)


@pytest.fixture(scope="module")
def corpus(world):
    from evals.generator.corpus import build_corpus

    return build_corpus(world, seed=42)


def test_agent_cases_cover_every_tool_and_abstention(world, invoices, corpus):
    from evals.generator.cases import agent_rows

    rows = agent_rows(world, invoices, corpus, seed=42)
    assert rows == agent_rows(world, invoices, corpus, seed=42)
    assert len(rows) == 40 and len({r["id"] for r in rows}) == 40
    first = Counter(r["expected_first_tool"] for r in rows)
    assert first == {"run_sql": 13, "search_documents": 10, "get_anomalies": 4, "forecast": 4,
                     "get_invoice": 3, None: 6}
    for r in rows:
        assert set(r) >= {"id", "question", "expected_tools", "expected_first_tool", "user", "answerable", "split"}
        assert set(r["expected_tools"]) <= TOOLS
        assert r["answerable"] == (r["expected_first_tool"] is not None)
        assert r["expected_tools"] == ([r["expected_first_tool"]] if r["answerable"] else [])
    stored = {t["invoice_number"] for t in world["transactions"]}
    for r in rows:
        if r["expected_first_tool"] == "get_invoice":
            assert any(number in r["question"] for number in stored)


def test_tenant_cases_name_only_the_other_users_data(world, invoices, corpus):
    from evals.generator.cases import safety_rows

    rows = safety_rows(world, invoices, corpus, seed=42)
    assert rows == safety_rows(world, invoices, corpus, seed=42)
    tenant = [r for r in rows if r["kind"] == "tenant"]
    assert len(tenant) == 10
    vendors = {u["key"]: {t["vendor_name"] for t in world["transactions"] if t["user_id"] == u["id"]}
               for u in world["users"]}
    for r in tenant:
        assert r["must_not"], r["id"]
        for value in r["must_not"]:
            assert value not in r["question"], r["id"]  # echoing the question back is not a leak
        other = "u2" if r["user"] == "u1" else "u1"
        own_only = vendors[r["user"]] - vendors[other]
        assert not any(v in r["must_not"] for v in own_only), r["id"]


def test_injection_cases_carry_a_canary_and_use_the_injected_invoices(world, invoices, corpus):
    from evals.generator.cases import safety_rows

    rows = [r for r in safety_rows(world, invoices, corpus, seed=42) if r["kind"] == "injection"]
    assert len(rows) == 10
    injected = {f"invoices/{inv['id']}-clean.png" for inv in invoices if "injection" in inv["faults"]}
    assert {r["file"] for r in rows if r.get("file")} == injected
    for r in rows:
        assert r["must_not"]
        assert bool(r.get("file")) != bool(r.get("document"))
        if r.get("document"):
            assert any(canary in r["document"] for canary in r["must_not"])
    assert {r["split"] for r in rows} == {"dev", "test"}
