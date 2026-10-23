from llm import client
from llm.providers import PROVIDERS, REASONING_OFF
from llm.registry import BYOK_PROVIDERS, Registry


def test_catalogue_covers_every_provider_and_role():
    reg = Registry.load()
    for p in BYOK_PROVIDERS:
        assert reg.byok(p, "agent") and reg.byok(p, "text"), p
        assert all(e.provider == p for e in reg.byok(p, "agent"))
    assert reg.byok("groq", "vision") == []          # no Groq vision model: falls back
    assert reg.byok("nope", "agent") == []


def test_platform_chain_unchanged():
    reg = Registry.load()
    # snapshot of today's chains (copy the real output of the current code into these literals before editing)
    assert [(e.provider, e.model) for e in reg.chain("groq", "text", env={})] == [
        ("groq", "openai/gpt-oss-120b"), ("groq", "qwen/qwen3.8-27b"), ("groq", "openai/gpt-oss-20b"),
        ("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"), ("openrouter", "qwen/qwen3.8-27b:free")]
    assert all(e.key is None for e in reg.chain("groq", "vision", env={}))


def test_entry_repr_hides_key():
    e = Registry.load().byok("openai", "agent")[0]
    from dataclasses import replace
    assert "sk-secret" not in repr(replace(e, key="sk-secret"))


def test_adapt_payloads():
    base = {"model": "m", "messages": [], "temperature": 0.0, "max_tokens": 300, "seed": 1}
    oa = PROVIDERS["openai"].adapt(dict(base))
    assert "temperature" not in oa and "max_tokens" not in oa and oa["max_completion_tokens"] == 300
    an = PROVIDERS["anthropic"].adapt(dict(base))
    assert "temperature" not in an and "seed" not in an and an["max_tokens"] == 300
    assert PROVIDERS["groq"].adapt(dict(base)) == base
    assert PROVIDERS["anthropic"].reasoning_params("claude-haiku-5-5", REASONING_OFF) == {"thinking": {"type": "disabled"}}
    assert PROVIDERS["anthropic"].reasoning_params("claude-opus-5-5", REASONING_OFF) == {}
    assert PROVIDERS["openai"].reasoning_params("gpt-6-luna", REASONING_OFF) == {"reasoning_effort": "low"}


def test_user_key_goes_in_the_header(monkeypatch):
    sent = {}

    class R:
        status_code, headers = 200, {}
        def json(self): return {"choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}]}

    monkeypatch.setattr(client.requests, "post", lambda url, headers, json, timeout: sent.update(h=headers, j=json, u=url) or R())
    from dataclasses import replace
    entry = replace(Registry.load().byok("anthropic", "text")[0], key="sk-ant-user")
    client.complete([{"role": "user", "content": "x"}], chain=[entry])
    assert sent["h"]["Authorization"] == "Bearer sk-ant-user"
    assert sent["u"] == "https://api.anthropic.com/v1/chat/completions"
    assert "temperature" not in sent["j"]


def test_check_key_uses_given_key(monkeypatch):
    seen = {}

    class R:
        status_code = 200
        def json(self): return {"data": [{}, {}]}

    monkeypatch.setattr("llm.providers.requests.get", lambda url, headers, timeout: seen.update(u=url, h=headers) or R())
    ok, _ = PROVIDERS["anthropic"].check_key(key="sk-ant-x")
    assert ok and seen["h"]["x-api-key"] == "sk-ant-x" and seen["u"].endswith("/v1/models")
    ok, _ = PROVIDERS["openai"].check_key(key="sk-x")
    assert ok and seen["h"]["Authorization"] == "Bearer sk-x"
