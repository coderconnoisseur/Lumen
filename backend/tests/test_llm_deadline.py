"""Request-scoped wall-clock budget for LLM calls (SPEC-LLM, 6b #7)."""
import threading
import time

import pytest


@pytest.fixture
def clock(monkeypatch):
    from llm import deadline

    now = {"t": 1000.0}
    monkeypatch.setattr(deadline, "_clock", lambda: now["t"])
    return now


def test_deadline_is_a_fatal_error_kind():
    from llm.errors import LLMError

    assert LLMError(LLMError.DEADLINE, "x").is_fatal


def test_utils_llm_reexports_the_same_error_class():
    from llm.errors import LLMError
    from utils.llm import LLMError as FacadeError

    assert FacadeError is LLMError


def test_no_deadline_means_the_callers_timeout(clock):
    from llm.deadline import call_timeout, remaining

    assert remaining() is None
    assert call_timeout(30) == 30


def test_call_gets_the_time_left_minus_a_margin(clock):
    from llm.deadline import call_timeout, request_deadline

    with request_deadline(100):
        clock["t"] += 90  # 10 s left
        assert call_timeout(30) == pytest.approx(8.0)


def test_under_three_seconds_left_raises_without_calling(clock):
    from llm.deadline import call_timeout, request_deadline
    from llm.errors import LLMError

    with request_deadline(100):
        clock["t"] += 97.5
        with pytest.raises(LLMError) as excinfo:
            call_timeout(30)
    assert excinfo.value.kind == LLMError.DEADLINE


def test_nested_deadline_keeps_the_earlier_one(clock):
    from llm.deadline import remaining, request_deadline

    with request_deadline(10):
        with request_deadline(100):
            assert remaining() == pytest.approx(10)
        assert remaining() == pytest.approx(10)
    assert remaining() is None


def test_hung_call_is_abandoned_at_its_slice():
    from llm.deadline import run_capped
    from llm.errors import LLMError

    release = threading.Event()
    start = time.monotonic()
    with pytest.raises(LLMError) as excinfo:
        run_capped(lambda: release.wait(5), seconds=0.2)
    release.set()
    assert excinfo.value.kind == LLMError.UNAVAILABLE
    assert time.monotonic() - start < 2


def test_capped_call_returns_and_reraises():
    from llm.deadline import run_capped

    assert run_capped(lambda: 42, seconds=1) == 42
    with pytest.raises(ZeroDivisionError):
        run_capped(lambda: 1 / 0, seconds=1)


def test_flask_requests_run_under_the_default_deadline(authed_client, monkeypatch):
    import routes.chat as chat
    from llm.deadline import remaining

    seen = {}

    def fake_query(q, uid):
        seen["remaining"] = remaining()
        return {"query": q, "query_type": "ANALYTICAL", "raw_results": {}, "response": "ok"}

    monkeypatch.setattr(chat.engine, "query", fake_query)
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: None)
    resp = authed_client.post("/chat", json={"query": "hi"}, headers={"Authorization": "Bearer x.y.z"})
    assert resp.status_code == 200
    assert 95 < seen["remaining"] <= 100
    assert remaining() is None  # reset after the request


def test_existing_callers_respect_the_request_budget(clock, monkeypatch):
    # Every caller goes through utils.llm.chat_completion, so the anomaly loop,
    # the forecast and the chat steps all stop when the request's time is spent.
    from utils import llm

    calls = []
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: calls.append(1))
    from llm.deadline import request_deadline

    with request_deadline(100):
        clock["t"] += 98
        with pytest.raises(llm.LLMError) as excinfo:
            llm.chat_completion("explain this anomaly")
    assert excinfo.value.kind == llm.LLMError.DEADLINE and excinfo.value.is_fatal
    assert calls == []
