"""llm.client.complete(): failover, retries, deadline, cassette, telemetry (SPEC-LLM)."""
import logging

import pytest

OK = {"model": "served/m", "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}],
      "usage": {"prompt_tokens": 5, "completion_tokens": 2}}
EMPTY = {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}
MSGS = [{"role": "user", "content": "hi"}]


class _Resp:
    def __init__(self, status, body, headers=None):
        self.status_code = status
        self._body = body
        self.text = str(body)
        self.headers = headers or {}

    def json(self):
        return self._body


@pytest.fixture
def transport(monkeypatch):
    """Scripted provider: pop one response per call, record what was sent."""
    from llm import client

    calls, script = [], []

    def post(url, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        item = script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(client.requests, "post", post)
    monkeypatch.setattr(client, "_sleep", lambda s: calls.append({"slept": s}))
    return calls, script


def chain(*pairs):
    from llm.registry import Entry

    return [Entry(p, m, m) for p, m in pairs]


def test_success_returns_a_typed_result(transport):
    from llm.client import complete

    calls, script = transport
    script.append(_Resp(200, OK))
    result = complete(MSGS, chain=chain(("groq", "m1")))
    assert result.text == "hello"
    assert (result.provider, result.model) == ("groq", "served/m")
    assert result.usage == {"prompt": 5, "completion": 2, "reasoning": None}
    assert result.cached is False and result.tool_calls is None
    assert calls[0]["url"] == "https://api.groq.com/openai/v1/chat/completions"


def test_payload_has_one_model_and_only_the_fields_that_were_set(transport):
    from llm.client import complete

    calls, script = transport
    script.extend([_Resp(200, OK), _Resp(200, OK)])
    complete(MSGS, chain=chain(("openrouter", "a/one")), max_tokens=40)
    sent = calls[0]["json"]
    assert sent["model"] == "a/one" and "models" not in sent
    assert sent["reasoning"] == {"enabled": False} and sent["max_tokens"] == 40
    assert not {"tools", "response_format", "seed"} & set(sent)

    tools = [{"type": "function", "function": {"name": "run_sql"}}]
    complete(MSGS, chain=chain(("ollama", "qwen3:4b")), tools=tools, response_format={"type": "json_object"}, seed=7)
    sent = calls[1]["json"]
    assert sent["tools"] == tools and sent["response_format"] == {"type": "json_object"}
    assert sent["seed"] == 7 and sent["think"] is False and "reasoning" not in sent


def test_rate_limit_fails_over_to_the_next_entry(transport):
    from llm.client import complete

    calls, script = transport
    script.extend([_Resp(429, {"error": {"message": "slow down"}}), _Resp(200, OK)])
    result = complete(MSGS, chain=chain(("groq", "m1"), ("openrouter", "a/one")))
    assert result.provider == "openrouter"
    assert [c["json"]["model"] for c in calls] == ["m1", "a/one"]


@pytest.mark.parametrize("status", [404, 500])
def test_config_and_outage_fail_over(transport, status):
    from llm.client import complete

    calls, script = transport
    script.extend([_Resp(status, {"error": {"message": "x"}}), _Resp(200, OK)])
    assert complete(MSGS, chain=chain(("groq", "m1"), ("groq", "m2"))).text == "hello"


def test_network_error_fails_over(transport):
    import requests
    from llm.client import complete

    calls, script = transport
    script.extend([requests.ConnectionError("refused"), _Resp(200, OK)])
    assert complete(MSGS, chain=chain(("ollama", "q"), ("groq", "m1"))).provider == "groq"


def test_auth_failure_skips_the_rest_of_that_provider(transport):
    from llm.client import complete

    calls, script = transport
    script.extend([_Resp(401, {"error": {"message": "User not found."}}), _Resp(200, OK)])
    result = complete(MSGS, chain=chain(("openrouter", "a/one"), ("openrouter", "a/two"), ("groq", "m1")))
    assert result.provider == "groq"
    assert [c["json"]["model"] for c in calls] == ["a/one", "m1"]


def test_last_error_is_raised_when_the_chain_is_exhausted(transport):
    from llm.client import complete
    from llm.errors import LLMError

    calls, script = transport
    script.extend([_Resp(429, {"error": {"message": "x"}}), _Resp(401, {"error": {"message": "y"}})])
    with pytest.raises(LLMError) as excinfo:
        complete(MSGS, chain=chain(("groq", "m1"), ("openrouter", "a/one")))
    assert excinfo.value.kind == LLMError.AUTH


def test_bad_response_retries_the_same_entry_then_is_raised(transport):
    # SPEC-LLM: an unusable reply is retried on the same entry, not failed
    # over; callers like OCR count on a fixed number of requests per call.
    from llm.client import complete
    from llm.errors import LLMError

    calls, script = transport
    script.extend([_Resp(200, EMPTY), _Resp(200, EMPTY)])
    with pytest.raises(LLMError) as excinfo:
        complete(MSGS, chain=chain(("groq", "m1"), ("groq", "m2")), retries=1)
    assert excinfo.value.kind == LLMError.BAD_RESPONSE
    assert [c["json"]["model"] for c in calls] == ["m1", "m1"]


def test_error_reported_with_http_200(transport):
    from llm.client import complete
    from llm.errors import LLMError

    calls, script = transport
    script.append(_Resp(200, {"error": {"message": "Rate limit exceeded", "code": 429}}))
    with pytest.raises(LLMError) as excinfo:
        complete(MSGS, chain=chain(("openrouter", "a/one")))
    assert excinfo.value.kind == LLMError.RATE_LIMITED


def test_tool_calls_count_as_a_usable_reply(transport):
    from llm.client import complete

    calls, script = transport
    call = {"id": "c1", "type": "function", "function": {"name": "run_sql", "arguments": "{}"}}
    script.append(_Resp(200, {"choices": [{"message": {"content": None, "tool_calls": [call]},
                                           "finish_reason": "tool_calls"}]}))
    result = complete(MSGS, chain=chain(("groq", "m1")), tools=[{"type": "function"}])
    assert result.tool_calls == [call] and result.text == ""


def test_short_retry_after_is_honoured_on_the_same_entry(transport):
    from llm.client import complete
    from llm.deadline import request_deadline

    calls, script = transport
    script.extend([_Resp(429, {"error": {"message": "x"}}, {"Retry-After": "1"}), _Resp(200, OK)])
    with request_deadline(60):
        complete(MSGS, chain=chain(("groq", "m1"), ("groq", "m2")))
    assert {"slept": 1.0} in calls
    assert [c["json"]["model"] for c in calls if "json" in c] == ["m1", "m1"]


def test_retry_after_longer_than_the_budget_fails_over_without_sleeping(transport):
    from llm.client import complete
    from llm.deadline import request_deadline

    calls, script = transport
    script.extend([_Resp(429, {"error": {"message": "x"}}, {"Retry-After": "50"}), _Resp(200, OK)])
    with request_deadline(20):
        complete(MSGS, chain=chain(("groq", "m1"), ("groq", "m2")))
    assert not any("slept" in c for c in calls)


def test_no_time_left_raises_deadline_without_calling(transport, monkeypatch):
    from llm import deadline
    from llm.client import complete
    from llm.errors import LLMError

    calls, script = transport
    now = {"t": 0.0}
    monkeypatch.setattr(deadline, "_clock", lambda: now["t"])
    with deadline.request_deadline(10):
        now["t"] = 8.5
        with pytest.raises(LLMError) as excinfo:
            complete(MSGS, chain=chain(("groq", "m1")))
    assert excinfo.value.kind == LLMError.DEADLINE and calls == []


def test_each_call_gets_at_most_the_time_left(transport, monkeypatch):
    from llm import deadline
    from llm.client import complete

    calls, script = transport
    script.append(_Resp(200, OK))
    now = {"t": 0.0}
    monkeypatch.setattr(deadline, "_clock", lambda: now["t"])
    with deadline.request_deadline(100):
        now["t"] = 88.0
        complete(MSGS, chain=chain(("groq", "m1")), timeout=30)
    assert calls[0]["timeout"] == pytest.approx(10.0)


# --- cassette -------------------------------------------------------------------


@pytest.fixture
def cassettes(tmp_path, monkeypatch):
    from llm import cassette

    monkeypatch.setenv("LUMEN_CASSETTE_DIR", str(tmp_path))
    cassette.clear_memory()
    yield cassette
    cassette.clear_memory()


def test_record_then_replay_gives_the_same_result_without_calling(transport, cassettes, monkeypatch):
    from llm.client import complete

    calls, script = transport
    script.append(_Resp(200, OK))
    monkeypatch.setenv("LUMEN_LLM_CACHE", "record")
    with cassettes.cassette_scope("sql"):
        live = complete(MSGS, chain=chain(("groq", "m1")))
    monkeypatch.setenv("LUMEN_LLM_CACHE", "replay")
    cassettes.clear_memory()
    with cassettes.cassette_scope("sql"):
        replayed = complete(MSGS, chain=chain(("groq", "m1")))
    assert len(calls) == 1
    assert replayed.cached is True and live.cached is False
    assert (replayed.text, replayed.model, replayed.usage, replayed.latency_s) == (
        live.text, live.model, live.usage, live.latency_s)


def test_replay_miss_raises_and_never_calls(transport, cassettes, monkeypatch):
    from llm.cassette import CassetteMiss
    from llm.client import complete

    calls, script = transport
    monkeypatch.setenv("LUMEN_LLM_CACHE", "replay")
    with cassettes.cassette_scope("sql", case="q-01"):
        with pytest.raises(CassetteMiss, match="q-01"):
            complete(MSGS, chain=chain(("groq", "m1")))
    assert calls == []


def test_telemetry_line_names_provider_and_cache(transport, caplog):
    from llm.client import complete

    calls, script = transport
    script.append(_Resp(200, OK))
    with caplog.at_level(logging.INFO, logger="llm.client"):
        complete(MSGS, chain=chain(("groq", "m1")))
    line = next(r.getMessage() for r in caplog.records if "served=" in r.getMessage())
    assert "provider=groq" in line and "cached=False" in line and "latency=" in line


def test_role_chain_comes_from_the_registry_for_the_tier(transport, monkeypatch):
    from llm import client

    calls, script = transport
    script.append(_Resp(200, OK))
    monkeypatch.setenv("LUMEN_LLM_TIER", "ollama")
    client.complete(MSGS, role="text")
    assert calls[0]["url"].startswith("http://localhost:11434/v1") and calls[0]["json"]["model"] == "qwen2.5:3b"
