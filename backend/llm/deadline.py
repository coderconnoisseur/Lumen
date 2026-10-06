"""Request-scoped wall-clock budget for LLM calls.

`requests`/`httpx` timeouts bound each socket read, not the whole call, and a
request can make several LLM calls in a row (classify, SQL, answer; or the
anomaly loop plus a forecast). So the budget lives here: the web layer opens a
`request_deadline` per request, every call asks `call_timeout` for its slice,
and `run_capped` abandons a call that outlives that slice.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import os
import time
from contextlib import contextmanager

from llm.errors import LLMError

# Below gunicorn/uvicorn's 120 s, so we answer before the server gives up.
DEFAULT_REQUEST_SECONDS = float(os.getenv("LUMEN_REQUEST_DEADLINE_S", "100"))
MARGIN_SECONDS = 2.0  # left for parsing the reply and writing the response
MIN_CALL_SECONDS = 3.0  # less than this left: don't start a call at all

_clock = time.monotonic
_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar("llm_deadline", default=None)
# Abandoned calls keep running here until their own socket timeout fires.
_pool = concurrent.futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm-call")


@contextmanager
def request_deadline(seconds: float = DEFAULT_REQUEST_SECONDS):
    """Budget `seconds` from now. Nested budgets keep the earlier deadline."""
    proposed = _clock() + seconds
    current = _deadline.get()
    token = _deadline.set(proposed if current is None else min(current, proposed))
    try:
        yield
    finally:
        _deadline.reset(token)


def remaining() -> float | None:
    """Seconds left in the current request's budget, or None outside one."""
    end = _deadline.get()
    return None if end is None else end - _clock()


def call_timeout(timeout: float) -> float:
    """The time one LLM call may take: `timeout`, cut to what the request has left."""
    left = remaining()
    if left is None:
        return timeout
    if left < MIN_CALL_SECONDS:
        raise LLMError(LLMError.DEADLINE, f"request budget exhausted ({max(left, 0):.1f}s left)")
    return min(timeout, left - MARGIN_SECONDS)


def run_capped(fn, *, seconds: float):
    """Run `fn()` and give up on it after `seconds` (raises LLMError UNAVAILABLE).

    The call keeps running in the background until its own socket timeout; we
    just stop waiting for it.
    """
    ctx = contextvars.copy_context()
    future = _pool.submit(ctx.run, fn)
    try:
        return future.result(timeout=seconds)
    except concurrent.futures.TimeoutError as e:
        future.cancel()
        raise LLMError(LLMError.UNAVAILABLE, f"LLM call abandoned after {seconds:.1f}s") from e


def install_flask(app, seconds: float = DEFAULT_REQUEST_SECONDS) -> None:
    """Run every Flask request under a `request_deadline`."""
    from flask import g

    @app.before_request
    def _open_llm_deadline():
        cm = request_deadline(seconds)
        cm.__enter__()
        g._llm_deadline = cm

    @app.teardown_request
    def _close_llm_deadline(_exc):
        cm = g.pop("_llm_deadline", None)
        if cm is not None:
            cm.__exit__(None, None, None)
