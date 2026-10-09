"""Ask Lumen pipeline: LLM provider failures must surface as clear errors."""

import pytest


class _FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


@pytest.mark.parametrize(
    "status, body, kind",
    [
        (401, {"error": {"message": "User not found.", "code": 401}}, "auth"),
        (402, {"error": {"message": "Insufficient credits", "code": 402}}, "insufficient_credits"),
        (429, {"error": {"message": "Rate limit exceeded", "code": 429}}, "rate_limited"),
        (404, {"error": {"message": "No endpoints found for x:free.", "code": 404}}, "config"),
        (502, {"error": {"message": "Provider returned error", "code": 502}}, "unavailable"),
        # OpenRouter sometimes reports failures with HTTP 200 and an error body.
        (200, {"error": {"message": "Rate limit exceeded", "code": 429}}, "rate_limited"),
        (200, {"choices": [{"message": {"content": "   "}}]}, "bad_response"),
    ],
)
def test_chat_completion_maps_provider_failures(monkeypatch, status, body, kind):
    from utils import llm

    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _FakeResponse(status, body))
    with pytest.raises(llm.LLMError) as excinfo:
        llm.chat_completion("hello")
    assert excinfo.value.kind == kind


def test_chat_completion_retries_once_after_empty_reply(monkeypatch):
    from utils import llm

    replies = iter(
        [
            _FakeResponse(200, {"choices": [{"message": {"content": ""}}]}),
            _FakeResponse(200, {"choices": [{"message": {"content": "ANALYTICAL"}}]}),
        ]
    )
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: next(replies))
    assert llm.chat_completion("classify") == "ANALYTICAL"


def test_chat_completion_does_not_retry_fatal_errors(monkeypatch):
    from utils import llm

    calls = []

    def dead_key(*a, **k):
        calls.append(1)
        return _FakeResponse(401, {"error": {"message": "User not found.", "code": 401}})

    monkeypatch.setattr(llm.requests, "post", dead_key)
    with pytest.raises(llm.LLMError):
        llm.chat_completion("hi")
    assert len(calls) == 1


def test_chat_completion_fails_over_along_the_configured_chain(monkeypatch):
    # SPEC-LLM: failover is client-side (one model per request), in registry or
    # env order, deduplicated; OpenRouter's server-side `models` array is gone.
    from utils import llm

    monkeypatch.setenv("LLM_TEXT_MODEL", "primary/model:free")
    monkeypatch.setenv("LLM_TEXT_FALLBACK_MODELS", "backup/one:free, primary/model:free,backup/two")
    sent = []

    def capture(url, headers, json, timeout):
        sent.append(json)
        if len(sent) < 3:
            return _FakeResponse(429, {"error": {"message": "Rate limit exceeded", "code": 429}})
        return _FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(llm.requests, "post", capture)
    assert llm.chat_completion("hi") == "ok"
    assert [s["model"] for s in sent] == ["primary/model:free", "backup/one:free", "backup/two"]
    assert all("models" not in s for s in sent)

    sent.clear()
    monkeypatch.setattr(llm.requests, "post", lambda url, headers, json, timeout: (
        sent.append(json) or _FakeResponse(200, {"choices": [{"message": {"content": "ok"}}]})))
    llm.chat_completion("hi", model="explicit/model")
    assert [s["model"] for s in sent] == ["explicit/model"]


def test_chat_completion_returns_text(monkeypatch):
    from utils import llm

    body = {"choices": [{"message": {"content": "  42 transactions  "}}]}
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _FakeResponse(200, body))
    assert llm.chat_completion("hello") == "42 transactions"


def test_chat_answers_from_sql(monkeypatch):
    import ai.hybrid_query_engine as hqe

    class Sql:
        called = False

        def query(self, q, uid):
            Sql.called = True
            return {"success": True, "data": [], "row_count": 0}

    engine = hqe.HybridQueryEngine.__new__(hqe.HybridQueryEngine)
    engine.sql_agent = Sql()
    monkeypatch.setattr(hqe, "chat_completion", lambda *a, **k: "No transactions yet.")

    result = engine.query("coffee purchases", "user-1")
    assert Sql.called
    assert result["query_type"] == "ANALYTICAL"


def test_synthesis_prompt_serializes_results_as_compact_json(monkeypatch):
    import ai.hybrid_query_engine as hqe

    class Sql:
        def query(self, q, uid):
            return {
                "success": True,
                "data": [{"vendor_name": "Berghotel Müller", "total_amount": 42}],
                "row_count": 1,
            }

    engine = hqe.HybridQueryEngine.__new__(hqe.HybridQueryEngine)
    engine.sql_agent = Sql()

    prompts = []

    def capture(prompt, **kwargs):
        prompts.append(prompt)
        return "Found one transaction."

    monkeypatch.setattr(hqe, "chat_completion", capture)

    engine.query("last bill", "user-1")
    assert len(prompts) == 1
    assert '"vendor_name":"Berghotel Müller"' in prompts[0]


def test_chat_llm_auth_failure_is_503_not_401(authed_client, monkeypatch):
    # A 401 would make the frontend sign the user out; a dead API key is our
    # problem, not an expired session.
    import routes.chat as chat
    from utils.llm import LLMError

    saved = []
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: saved.append(a))

    def dead_key(q, uid):
        raise LLMError(LLMError.AUTH, "OpenRouter HTTP 401: User not found.")

    monkeypatch.setattr(chat, "_ask", dead_key)

    resp = authed_client.post(
        "/chat", json={"query": "hi"}, headers={"Authorization": "Bearer x.y.z"}
    )
    assert resp.status_code == 503
    body = resp.get_json()
    assert body["code"] == "llm_unavailable"
    assert "User not found" not in body["error"]
    assert saved == []


def test_chat_success_returns_answer_and_saves_history(authed_client, monkeypatch):
    import routes.chat as chat

    saved = []
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: saved.append(a))
    monkeypatch.setattr(chat, "_ask", lambda q, uid: {"query": q, "query_type": "agent",
                                                     "response": "You have no transactions yet."})

    resp = authed_client.post(
        "/chat", json={"query": "total spend"}, headers={"Authorization": "Bearer x.y.z"}
    )
    assert resp.status_code == 200
    assert resp.get_json()["data"]["response"] == "You have no transactions yet."
    assert saved == [("user-1", "total spend", "You have no transactions yet.")]


@pytest.fixture
def txn_db(tmp_path):
    import sqlite3

    path = tmp_path / "txns.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "create table transactions (id text, user_id text, date text, total_amount real, "
        "vendor_name text, category text)"
    )
    conn.executemany(
        "insert into transactions values (?,?,?,?,?,?)",
        [
            ("t1", "user-1", "2026-09-05", 2400.0, "Reliance Fresh", "Groceries"),
            ("t2", "user-1", "2026-09-11", 650.0, "Starbucks", "Restaurant"),
            ("t3", "user-2", "2026-09-12", 99999.0, "Other Tenant", "Groceries"),
        ],
    )
    conn.commit()
    conn.close()
    return str(path)


def test_sql_agent_keeps_only_first_statement_from_chatty_reply(txn_db, monkeypatch):
    from ai.sql_agent import SQLAgent

    agent = SQLAgent(txn_db)
    monkeypatch.setattr(
        agent,
        "generate_sql",
        lambda q, uid: (
            "Here is the query:\nSELECT COALESCE(SUM(total_amount), 0) AS total FROM transactions "
            "WHERE user_id = 'user-1' AND LOWER(category) = 'groceries'; "
            "SELECT * FROM transactions"
        ),
    )
    result = agent.query("grocery total", "user-1")
    assert result["success"]
    assert result["data"] == [{"total": 2400.0}]


def test_sql_agent_falls_back_to_recent_transactions_when_sql_rejected(txn_db, monkeypatch):
    from ai.sql_agent import SQLAgent

    agent = SQLAgent(txn_db)
    # No user_id filter: must be rejected, then replaced by the safe fallback.
    monkeypatch.setattr(agent, "generate_sql", lambda q, uid: "SELECT * FROM transactions")
    result = agent.query("coffee purchases", "user-1")
    assert result["success"]
    assert {row["vendor_name"] for row in result["data"]} == {"Reliance Fresh", "Starbucks"}
    assert "note" in result


def test_find_shadowed_keys():
    from config import find_shadowed_keys

    file_values = {"OPENROUTER_API_KEY": "from-file", "PORT": "5000", "EMPTY": ""}
    environ = {"OPENROUTER_API_KEY": "stale-system-key", "PORT": "5000", "EMPTY": "x"}
    assert find_shadowed_keys(file_values, environ) == ["OPENROUTER_API_KEY"]


def test_chat_steps_fit_the_request_budget(monkeypatch):
    # SQL (30s, no retry) + answer (30s, one retry) is about 90s at worst, inside the 100s request deadline.
    import ai.hybrid_query_engine as hqe
    import ai.sql_agent as sa

    calls = {}

    def capture(name, reply):
        def fake(prompt, **kwargs):
            calls[name] = kwargs
            return reply

        return fake

    agent = sa.SQLAgent.__new__(sa.SQLAgent)
    agent.dialect = "sqlite"
    monkeypatch.setattr(sa, "chat_completion", capture("sql", "SELECT 1"))
    agent.generate_sql("coffee", "user-1")

    engine = hqe.HybridQueryEngine.__new__(hqe.HybridQueryEngine)
    monkeypatch.setattr(hqe, "chat_completion", capture("answer", "ok"))
    engine._synthesize_response("q", {"success": True, "data": []}, "sql")

    assert (calls["sql"]["timeout"], calls["sql"]["retries"]) == (30, 0)
    assert calls["answer"]["timeout"] == 30
    assert calls["answer"].get("retries", 1) == 1


def test_chat_is_the_agent(authed_client, monkeypatch):
    """Ask Lumen runs the agent loop (AGT-07 passed its gates): a scripted model calls run_sql, then answers."""
    import json

    import routes.chat as chat
    from ai.sql_agent import SQLAgent
    from api import agent as agent_api
    from llm.client import LLMResult
    from models.database import db
    from app import app

    replies = [LLMResult(text="", tool_calls=[{"id": "c1", "type": "function", "function": {
                   "name": "run_sql", "arguments": json.dumps({"sql": "SELECT COUNT(*) AS n FROM transactions"})}}],
                         provider="fake", model="fake"),
               LLMResult(text="You have no transactions yet.", tool_calls=None, provider="fake", model="fake")]
    with app.app_context():
        engine = db.engine
    deps = agent_api.AgentDeps(engine=engine, sql_agent=SQLAgent(), complete=lambda *a, **k: replies.pop(0))
    monkeypatch.setattr(agent_api, "get_agent_deps", lambda: deps)
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: None)
    resp = authed_client.post("/chat", json={"query": "How many?"}, headers={"Authorization": "Bearer x.y.z"})
    body = resp.get_json()["data"]
    assert resp.status_code == 200 and body["response"] == "You have no transactions yet."
    assert body["query_type"] == "agent" and [s["tool"] for s in body["steps"]] == ["run_sql"]
    assert "sql" not in body and "latency_ms" in body["steps"][0]  # queries stay server-side
    assert body["sources"] == [] and body["stopped"]


def test_chat_shares_the_demo_question_cap(authed_client, monkeypatch):
    import api.agent
    import routes.chat as chat

    monkeypatch.setattr(api.agent, "count_demo_question", lambda *a: False)
    monkeypatch.setattr(chat, "_ask", lambda *a: pytest.fail("the agent must not run past the cap"))
    resp = authed_client.post("/chat", json={"query": "hi"}, headers={"Authorization": "Bearer x.y.z"})
    assert resp.status_code == 429 and resp.get_json()["code"] == "demo_limit"


def test_chat_sources_carry_the_passage_and_the_original_file(authed_client, monkeypatch):
    import agent.graph
    import routes.chat as chat
    from api import agent as agent_api

    out = {"answer": "Notice is 30 days [doc-1#s02].", "rows": None, "sql": [], "stopped": "answered", "proposals": [],
           "steps": [{"tool": "search_documents", "args": {}, "summary": "1 passage", "latency_ms": 12}],
           "sources": [{"chunk_id": "doc-1#s02", "title": "TechHub contract", "section": "Termination",
                        "text": "Either party may end this with 30 days' notice."}]}
    monkeypatch.setattr(agent_api, "get_agent_deps", lambda: agent_api.AgentDeps(engine=None, sql_agent=None))
    monkeypatch.setattr(agent.graph, "run_agent", lambda *a, **k: out)
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: None)
    resp = authed_client.post("/chat", json={"query": "notice?"}, headers={"Authorization": "Bearer x.y.z"})
    source = resp.get_json()["data"]["sources"][0]
    assert source["file_key"] == "user-1/docs/doc-1.pdf" and source["text"].startswith("Either party")
