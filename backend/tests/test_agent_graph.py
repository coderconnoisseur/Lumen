"""AGT-02: the bounded agent loop, driven by a scripted fake model (no LLM calls)."""
import json

import pytest
from sqlalchemy import create_engine

from llm.client import LLMResult
from rag.store import Hit


def _call(name, args, cid=None):
    return {"id": cid or f"c-{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def _reply(text="", calls=None):
    return LLMResult(text=text, tool_calls=calls, provider="fake", model="fake")


class Script:
    """Plays back replies in order and records what the loop sent."""

    def __init__(self, *replies):
        self.replies, self.sent = list(replies), []

    def __call__(self, messages, **kwargs):
        self.sent.append({"messages": [dict(m) for m in messages], "tools": kwargs.get("tools")})
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]


class FakeRag:
    def search(self, user_id, query, k=5):
        return [Hit("doc#s03", "doc", 0.9, "Fees", "The customer pays INR 4,500.00 per month.", "TechHub agreement", "contract")]


@pytest.fixture(scope="module")
def ctx(tmp_path_factory):
    from agent.tools import ToolContext
    from ai.sql_agent import SQLAgent
    from evals.generator.db import load_world
    from evals.generator.world import AS_OF, build_world

    world = build_world(42)
    path = tmp_path_factory.mktemp("graph") / "w.db"
    load_world(create_engine(f"sqlite:///{path}"), world)
    return ToolContext(user_id=world["users"][0]["id"], engine=create_engine(f"sqlite:///{path}"),
                       sql_agent=SQLAgent(db_path=str(path)), rag=FakeRag(), today=AS_OF)


def test_tools_run_then_the_model_answers(ctx):
    from agent.graph import run_agent

    script = Script(
        _reply(calls=[_call("lookup_vendors", {"hint": "electricity"}, "a"),
                      _call("run_sql", {"sql": "SELECT AVG(total_amount) AS avg FROM transactions "
                                               "WHERE user_id = '{user_id}' AND vendor_name = 'City Power Ltd'"}, "b")]),
        _reply("Your average electricity bill is about INR 2,500."),
    )
    out = run_agent("What's my average electricity bill?", ctx, complete=script)
    assert out["stopped"] == "answered" and out["llm_calls"] == 2
    assert out["tools_used"] == ["lookup_vendors", "run_sql"]
    assert out["steps"][0]["summary"].startswith("City Power Ltd") and out["steps"][1]["summary"] == "1 row(s)"
    assert "City Power Ltd" in out["sql"][0]
    second = script.sent[1]["messages"]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "tool", "tool"]
    assert {m["tool_call_id"] for m in second if m["role"] == "tool"} == {"a", "b"}
    assert "2026-06-30" in second[0]["content"]  # today comes from the context


def test_the_loop_stops_at_the_tool_call_limit_and_forces_an_answer(ctx):
    from agent.graph import run_agent

    out = run_agent("loop forever", ctx, complete=_NeverStops(), max_tool_calls=3)
    assert out["stopped"] == "tool_limit" and len(out["steps"]) == 3


class _NeverStops(Script):
    """Keeps asking for tools until the loop takes them away."""

    def __call__(self, messages, **kwargs):
        self.sent.append({"tools": kwargs.get("tools")})
        if kwargs.get("tools") is None:  # the forced final turn has no tools
            assert "maximum number of tool calls" in messages[-1]["content"]
            return _reply("Here is what I found so far.")
        return _reply(calls=[_call("get_schema", {}, f"c{len(self.sent)}")])


def test_citations_must_come_from_retrieved_passages(ctx):
    from agent.graph import run_agent

    script = Script(_reply(calls=[_call("search_documents", {"query": "TechHub monthly fee"})]),
                    _reply("You pay INR 4,500.00 a month [doc#s03] (see also [made-up#s09])."))
    out = run_agent("What do we pay TechHub monthly?", ctx, complete=script)
    assert out["citations"] == ["doc#s03"]
    assert out["sources"][0]["title"] == "TechHub agreement"


def test_questions_needing_no_tools_are_answered_directly(ctx):
    from agent.graph import run_agent

    out = run_agent("Write a poem about my cat", ctx, complete=Script(_reply("I can only help with your business data.")))
    assert out["tools_used"] == [] and out["llm_calls"] == 1 and out["stopped"] == "answered"


def test_tool_results_are_truncated_before_going_back_to_the_model(ctx):
    from agent.graph import MAX_TOOL_RESULT_CHARS, run_agent

    script = Script(_reply(calls=[_call("lookup_vendors", {})]), _reply("done"))
    run_agent("list vendors", ctx, complete=script)
    tool_msg = next(m for m in script.sent[1]["messages"] if m["role"] == "tool")
    assert len(tool_msg["content"]) <= MAX_TOOL_RESULT_CHARS
