"""Provider adapters and the model registry (SPEC-LLM, 6b #4 and #11)."""
import pytest


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)
        self.headers = {}

    def json(self):
        return self._body


# --- adapters -----------------------------------------------------------------


def test_providers_are_registered():
    from llm.providers import PROVIDERS

    assert set(PROVIDERS) == {"openrouter", "groq", "ollama"}
    assert PROVIDERS["groq"].base_url == "https://api.groq.com/openai/v1"
    assert PROVIDERS["ollama"].base_url == "http://localhost:11434/v1"


def test_openrouter_turns_reasoning_off_with_its_own_field():
    from llm.providers import PROVIDERS, REASONING_OFF

    assert PROVIDERS["openrouter"].reasoning_params("any/model", REASONING_OFF) == {"reasoning": {"enabled": False}}
    assert PROVIDERS["openrouter"].reasoning_params("any/model", {"effort": "low"}) == {"reasoning": {"effort": "low"}}
    assert PROVIDERS["openrouter"].reasoning_params("any/model", None) == {}


@pytest.mark.parametrize(
    "model, expected",
    [
        ("openai/gpt-oss-20b", {"reasoning_effort": "low"}),
        ("qwen/qwen3-32b", {"reasoning_effort": "none"}),
        ("llama-3.3-70b-versatile", {}),
    ],
)
def test_groq_reasoning_off_depends_on_the_model(model, expected):
    from llm.providers import PROVIDERS, REASONING_OFF

    assert PROVIDERS["groq"].reasoning_params(model, REASONING_OFF) == expected


def test_ollama_turns_thinking_off():
    from llm.providers import PROVIDERS, REASONING_OFF

    assert PROVIDERS["ollama"].reasoning_params("qwen3:4b", REASONING_OFF) == {"think": False}


@pytest.mark.parametrize(
    "status, kind",
    [(400, "config"), (401, "auth"), (402, "insufficient_credits"), (403, "config"), (404, "config"),
     (408, "unavailable"), (429, "rate_limited"), (500, "unavailable"), (503, "unavailable"), (418, "bad_response")],
)
def test_status_to_kind_is_shared_by_every_provider(status, kind):
    from llm.providers import PROVIDERS

    for provider in PROVIDERS.values():
        assert provider.kind_for_status(status) == kind


def test_headers_carry_the_providers_own_key(monkeypatch):
    from llm.providers import PROVIDERS

    monkeypatch.setenv("GROQ_API_KEY", "test-groq-123")
    assert PROVIDERS["groq"].headers()["Authorization"] == "Bearer test-groq-123"
    assert "Authorization" not in PROVIDERS["ollama"].headers()


def test_groq_key_check_lists_models(monkeypatch):
    from llm import providers

    seen = []

    def fake_get(url, headers, timeout):
        seen.append(url)
        return _Resp(200, {"data": [{"id": "m1"}, {"id": "m2"}]})

    monkeypatch.setattr(providers.requests, "get", fake_get)
    ok, summary = providers.PROVIDERS["groq"].check_key()
    assert ok and "2 models" in summary
    assert seen == ["https://api.groq.com/openai/v1/models"]


def test_openrouter_key_check_reports_credit_not_requests(monkeypatch):
    """`limit_remaining` is the key's dollar credit, not the free-model request quota (~50/day)."""
    from llm import providers

    body = {"data": {"is_free_tier": True, "limit_remaining": 49.9999973}}
    monkeypatch.setattr(providers.requests, "get", lambda *a, **k: _Resp(200, body))
    ok, summary = providers.PROVIDERS["openrouter"].check_key()
    assert ok and "$50.00 of credit left" in summary
    assert "requests left" not in summary
    assert "free models are limited per day" in summary


def test_key_check_reports_rejection(monkeypatch):
    from llm import providers

    monkeypatch.setattr(providers.requests, "get", lambda *a, **k: _Resp(401, {"error": {"message": "Invalid API Key"}}))
    ok, summary = providers.PROVIDERS["groq"].check_key()
    assert not ok and "401" in summary


# --- registry ---------------------------------------------------------------------


def _write(tmp_path, text):
    path = tmp_path / "registry.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_chain_for_tier_falls_back_to_openrouter(tmp_path):
    from llm.registry import Registry

    reg = Registry.load(_write(tmp_path, """
groq:
  text: [{model: llama-3.3-70b-versatile, family: llama}]
openrouter:
  text: [{model: nvidia/nemotron-x:free, family: nemotron}]
"""))
    chain = reg.chain("groq", "text", env={})
    assert [(e.provider, e.model) for e in chain] == [
        ("groq", "llama-3.3-70b-versatile"),
        ("openrouter", "nvidia/nemotron-x:free"),
    ]


def test_env_overrides_the_openrouter_chain(tmp_path):
    from llm.registry import Registry

    reg = Registry.load(_write(tmp_path, "openrouter:\n  text: [{model: a/one, family: a}]\n"))
    chain = reg.chain("openrouter", "text", env={"LLM_TEXT_MODEL": "b/two", "LLM_TEXT_FALLBACK_MODELS": "c/three, b/two"})
    assert [e.model for e in chain] == ["b/two", "c/three"]
    assert [e.family for e in chain] == ["b", "c"]


def test_judge_sharing_the_text_family_is_rejected(tmp_path):
    from llm.registry import Registry, RegistryError

    reg = Registry.load(_write(tmp_path, """
groq:
  text: [{model: llama-3.3-70b-versatile, family: llama}]
  judge: [{model: llama-3.1-8b-instant, family: llama}]
"""))
    with pytest.raises(RegistryError, match="family"):
        reg.check("groq", env={})


def test_openrouter_free_in_a_chain_is_a_warning(tmp_path):
    from llm.registry import Registry

    reg = Registry.load(_write(tmp_path, "openrouter:\n  text: [{model: a/one, family: a}]\n"))
    warnings = reg.check("openrouter", env={"LLM_VISION_MODEL": "openrouter/free"})
    assert any("openrouter/free" in w for w in warnings)


def test_shipped_registry_has_no_openrouter_free_and_a_valid_judge():
    from llm.registry import Registry

    reg = Registry.load()
    for tier in ("openrouter", "groq", "ollama"):
        assert reg.check(tier, env={}) == []
