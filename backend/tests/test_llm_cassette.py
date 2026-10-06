"""Record/replay store for LLM calls (contract in SPEC-EVAL, SPEC-LLM)."""
import pytest

CALL = dict(
    provider="groq",
    model="m1",
    messages=[{"role": "user", "content": "hi"}],
    tools=None,
    response_format=None,
    temperature=0.0,
    max_tokens=50,
    seed=None,
)
ENTRY = {
    "provider": "groq",
    "model": "m1",
    "text": "hello",
    "tool_calls": None,
    "finish_reason": "stop",
    "usage": {"prompt": 3, "completion": 1, "reasoning": None},
    "latency_s": 0.42,
}


@pytest.fixture
def store(tmp_path, monkeypatch):
    from llm import cassette

    monkeypatch.setenv("LUMEN_CASSETTE_DIR", str(tmp_path))
    cassette.clear_memory()
    return cassette


def test_key_is_stable_and_changes_with_every_keyed_field(store):
    base = store.make_key(**CALL)
    assert base == store.make_key(**CALL)
    for field, other in [
        ("provider", "ollama"),
        ("model", "m2"),
        ("messages", [{"role": "user", "content": "hi!"}]),
        ("tools", [{"type": "function"}]),
        ("response_format", {"type": "json_object"}),
        ("temperature", 0.1),
        ("max_tokens", 51),
        ("seed", 7),
    ]:
        assert store.make_key(**{**CALL, field: other}) != base, field


def test_mode_defaults_to_off(store, monkeypatch):
    monkeypatch.delenv("LUMEN_LLM_CACHE", raising=False)
    assert store.mode() == "off"
    monkeypatch.setenv("LUMEN_LLM_CACHE", "replay")
    assert store.mode() == "replay"


def test_empty_mode_means_off(store, monkeypatch):
    monkeypatch.setenv("LUMEN_LLM_CACHE", "")
    assert store.mode() == "off"


def test_unknown_mode_is_rejected(store, monkeypatch):
    monkeypatch.setenv("LUMEN_LLM_CACHE", "sometimes")
    with pytest.raises(ValueError):
        store.mode()


def test_record_then_lookup_in_the_scoped_suite_file(store, tmp_path):
    key = store.make_key(**CALL)
    with store.cassette_scope("sql"):
        assert store.lookup("groq", key) is None
        store.record("groq", key, ENTRY)
        assert store.lookup("groq", key) == ENTRY
    assert (tmp_path / "groq" / "sql.jsonl").exists()
    with store.cassette_scope("extraction"):
        assert store.lookup("groq", key) is None


def test_lookup_reads_entries_written_by_an_earlier_process(store, tmp_path):
    key = store.make_key(**CALL)
    with store.cassette_scope("sql"):
        store.record("groq", key, ENTRY)
    store.clear_memory()
    with store.cassette_scope("sql"):
        assert store.lookup("groq", key) == ENTRY


def test_miss_error_names_the_suite_and_key(store):
    err = store.CassetteMiss(suite="sql", key="abc123", case="q-07")
    assert "sql" in str(err) and "abc123" in str(err) and "q-07" in str(err)
