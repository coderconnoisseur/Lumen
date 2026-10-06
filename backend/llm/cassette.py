"""Record/replay store for LLM calls.

Evals and CI must be free and deterministic, so every call can be keyed by
what was sent and answered from a JSONL "cassette" instead of the network.
Modes (`LUMEN_LLM_CACHE`):
  off     - the app's default: always call the provider.
  replay  - only answer from cassettes; a miss raises CassetteMiss (never a live call).
  record  - answer from cassettes when present, otherwise call and append.
Files live at `<LUMEN_CASSETTE_DIR>/<tier or provider>/<suite>.jsonl`.
"""
from __future__ import annotations

import contextvars
import hashlib
import json
import os
from contextlib import contextmanager
from pathlib import Path

MODES = ("off", "replay", "record")
_DEFAULT_DIR = Path(__file__).resolve().parents[1] / "evals" / "cassettes"

_suite: contextvars.ContextVar[str] = contextvars.ContextVar("llm_cassette_suite", default="default")
_case: contextvars.ContextVar[str | None] = contextvars.ContextVar("llm_cassette_case", default=None)
_seen: contextvars.ContextVar[dict | None] = contextvars.ContextVar("llm_cassette_seen", default=None)
_loaded: dict[Path, dict[str, dict]] = {}


class CassetteMiss(Exception):
    """Replay mode found no recording for a call. Not an LLMError: callers'
    fallbacks must not swallow it, or a stale cassette would look like a pass."""

    def __init__(self, *, suite: str, key: str, case: str | None = None):
        self.suite, self.key, self.case = suite, key, case
        where = f" case {case}" if case else ""
        super().__init__(
            f"no recorded LLM response for suite {suite!r}{where} (key {key[:12]}); "
            f"re-record with `python -m evals.run --record --suite {suite} --only-missing`"
        )


def mode() -> str:
    value = (os.getenv("LUMEN_LLM_CACHE") or "off").strip().lower()
    if value not in MODES:
        raise ValueError(f"LUMEN_LLM_CACHE must be one of {MODES}, not {value!r}")
    return value


def make_key(*, provider, model, messages, tools, response_format, temperature, max_tokens, seed) -> str:
    payload = [provider, model, messages, tools, response_format, temperature, max_tokens, seed]
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@contextmanager
def cassette_scope(suite: str, case: str | None = None):
    """Route calls made inside this block to the `suite` cassette."""
    tokens = (_suite.set(suite), _case.set(case), _seen.set({}))
    try:
        yield
    finally:
        _suite.reset(tokens[0])
        _case.reset(tokens[1])
        _seen.reset(tokens[2])


def peek(key: str) -> str:
    """The key `nth(key)` would return next, without counting this occurrence."""
    seen = _seen.get()
    count = 0 if seen is None else seen.get(key, 0)
    return key if count == 0 else f"{key}#{count}"


def nth(key: str) -> str:
    """The key for this occurrence of an identical request within the current scope.

    A caller that repeats a request (a retry after an unusable reply) gets a fresh reply live, so the
    second occurrence is its own recording and replay hands them back in the same order.
    """
    seen = _seen.get()
    if seen is None:
        return key
    count = seen.get(key, 0)
    seen[key] = count + 1
    return key if count == 0 else f"{key}#{count}"


def current_suite() -> str:
    return _suite.get()


def current_case() -> str | None:
    return _case.get()


def _path(shelf: str) -> Path:
    root = Path(os.getenv("LUMEN_CASSETTE_DIR") or _DEFAULT_DIR)
    return root / shelf / f"{_suite.get()}.jsonl"


def _entries(path: Path) -> dict[str, dict]:
    if path not in _loaded:
        entries: dict[str, dict] = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    entries[row["key"]] = row["entry"]
        _loaded[path] = entries
    return _loaded[path]


def lookup(shelf: str, key: str) -> dict | None:
    return _entries(_path(shelf)).get(key)


def record(shelf: str, key: str, entry: dict) -> None:
    path = _path(shelf)
    entries = _entries(path)
    if key in entries:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"key": key, "case": _case.get(), "entry": entry}, ensure_ascii=False) + "\n")
    entries[key] = entry


def clear_memory() -> None:
    """Forget loaded cassettes (tests; or after files change on disk)."""
    _loaded.clear()
