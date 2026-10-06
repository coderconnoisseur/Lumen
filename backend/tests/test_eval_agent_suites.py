"""AGT-07: the agent suites score the real loop and tools correctly (fake models stand in for the LLM)."""
import json
import re

import pytest

from evals.suites.common import DATA_DIR
from llm.client import LLMResult


def _rows(name):
    return {r["question"]: r for r in (json.loads(l) for l in (DATA_DIR / f"{name}.jsonl").read_text(encoding="utf-8").splitlines())}


def _call(name, args):
    return [{"id": "c1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]


def _reply(text="", calls=None):
    return LLMResult(text=text, tool_calls=calls, provider="fake", model="fake")


def _question(messages):
    return next(m["content"] for m in messages if m["role"] == "user")


@pytest.fixture
def fake(monkeypatch):
    """A fake model, plus fake local models: the queries a fake writes aren't in the committed caches."""
    import llm.client
    from evals.suites import retrieval
    from rag.embed import FakeEmbedder
    from rag.rerank import FakeReranker

    monkeypatch.setattr(retrieval, "embedder", lambda *a, **k: FakeEmbedder())
    monkeypatch.setattr(retrieval, "reranker", lambda *a, **k: FakeReranker())

    def install(fn):
        monkeypatch.setattr(llm.client, "complete", fn)

    return install


def test_a_perfect_router_scores_full_marks(fake):
    from evals.suites import agent

    by_q = _rows("agent")

    def router(messages, tools=None, **_):
        row = by_q[_question(messages)]
        if messages[-1]["role"] == "tool" or not row["answerable"]:
            return _reply("Here you go." if row["answerable"] else "I couldn't find that in your data.")
        args = {"run_sql": {"sql": "SELECT 1 FROM transactions WHERE user_id = '{user_id}'"},
                "search_documents": {"query": row["question"]}, "get_invoice": {"invoice_number": "X-1"},
                "get_anomalies": {}, "forecast": {"months": 1}}[row["expected_first_tool"]]
        return _reply(calls=_call(row["expected_first_tool"], args))

    fake(router)
    m = agent.run("groq", "dev")["metrics"]
    assert m["tool_selection_accuracy"]["passed"] == m["tool_selection_accuracy"]["total"] > 0
    assert m["abstention_accuracy"]["passed"] == m["abstention_accuracy"]["total"] == 28


def test_sql_through_the_agent_uses_the_last_querys_rows(fake):
    from evals.suites import agent

    gold = {q: r["gold_sql"] for q, r in _rows("sql").items()}

    def writer(messages, tools=None, **_):
        if messages[-1]["role"] == "tool":
            return _reply("Done.")
        return _reply(calls=_call("run_sql", {"sql": gold[_question(messages)]}))

    fake(writer)
    m = agent.run_sql("groq", "dev")["metrics"]
    assert m["execution_accuracy"]["passed"] == m["execution_accuracy"]["total"] == 32


def test_agent_safety_catches_a_model_that_repeats_what_it_reads(fake):
    from evals.suites import agent

    def parrot(messages, tools=None, **_):
        if messages[-1]["role"] == "tool":
            return _reply(messages[-1]["content"] + " " + _question(messages))
        if "document" in _question(messages).lower() or "contract" in _question(messages).lower():
            return _reply(calls=_call("search_documents", {"query": _question(messages)}))
        return _reply(_question(messages))  # echoes pasted documents straight back

    fake(parrot)
    out = agent.run_safety("groq", "dev")
    assert out["metrics"]["injections_followed"] > 0
    assert out["metrics"]["tenant_leaks"] == 0  # tools are scoped server-side, so echoing can't leak other users


def test_agent_safety_passes_a_careful_model(fake):
    from evals.suites import agent

    fake(lambda messages, tools=None, **_: _reply("Here is a short summary of your request."))
    out = agent.run_safety("groq", "dev")
    assert out["hard_gate_failures"] == [] and out["metrics"]["safe"]["passed"] == out["metrics"]["safe"]["total"]


@pytest.mark.parametrize("answer, used, row, abstained", [
    # 026: the right tool ran and found nothing; that's an answer, not a refusal
    ("I couldn't find any duplicate-charge anomalies in the last 90 days.", ["get_anomalies"],
     {"expected_first_tool": "get_anomalies", "answerable": True}, False),
    # v1's PO miss: gave up after the wrong tool
    ("I couldn't find any record for PO-U2-202509-02.", ["get_invoice"],
     {"expected_first_tool": "search_documents", "answerable": True}, True),
    # 040: off-topic, declined in words the old pattern missed
    ("I'm sorry, but I don't have information to answer that question.", [],
     {"expected_first_tool": None, "answerable": False}, True),
])
def test_abstention_means_giving_up_not_reporting_none_found(answer, used, row, abstained):
    from evals.suites.agent import _abstained

    assert _abstained(answer, used, row) is abstained


@pytest.mark.parametrize("used, expected, route", [
    (["lookup_vendors"], "run_sql", "run_sql"),  # 003/009/010: vendor totals come with the lookup
    (["lookup_vendors", "forecast"], "forecast", "forecast"),
    (["get_schema", "run_sql"], "run_sql", "run_sql"),
    (["lookup_vendors"], "forecast", None),  # the lookup only stands in for SQL
])
def test_route_counts_a_vendor_lookup_answer_as_sql(used, expected, route):
    from evals.suites.agent import _route

    assert _route(used, expected) == route
