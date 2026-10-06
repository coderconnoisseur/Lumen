"""Compatibility facade over the `llm` package (SPEC-LLM).

Existing callers (Ask Lumen, OCR, analytics) import `chat_completion`,
`LLMError` and `check_api_key` from here. They keep working unchanged while
the real client in `llm/` adds providers, tiers, failover, a per-request time
budget and record/replay.
"""
from __future__ import annotations

import requests  # noqa: F401  (tests patch `utils.llm.requests.post`; same module object)

from llm.client import complete, tier
from llm.errors import LLMError  # noqa: F401  (re-exported for callers)
from llm.providers import PROVIDERS, REASONING_OFF  # noqa: F401
from llm.registry import Entry, guess_family


def chat_completion(
    prompt: str | list,
    *,
    role: str = "text",
    temperature: float = 0.0,
    max_tokens: int = 500,
    model: str | None = None,
    fallback_models: list[str] | None = None,
    reasoning: dict | None = REASONING_OFF,
    timeout: float = 60,
    retries: int = 1,
) -> str:
    """Send one user message and return the reply text.

    `prompt` is plain text, or a list of content parts (text + image_url) for
    vision models. Without `model`, the chain for `role` comes from the active
    tier (`LUMEN_LLM_TIER`) in llm/registry.yaml. With `model` (and optional
    `fallback_models`), exactly those are tried; ids are OpenRouter ids unless
    prefixed `groq:` / `ollama:` / `openrouter:`.

    `reasoning` defaults to REASONING_OFF (each provider's own off switch);
    None leaves the model's default. Raises LLMError for any failure; never
    returns provider error text as if it were an answer. An empty or malformed
    reply is retried `retries` more times on the same model before moving on.
    Each try is cut to the request's time budget (llm/deadline.py).
    """
    chain = _explicit_chain(model, fallback_models) if model else None
    result = complete(
        [{"role": "user", "content": prompt}],
        role=role,
        chain=chain,
        temperature=temperature,
        max_tokens=max_tokens,
        reasoning=reasoning,
        timeout=timeout,
        retries=retries,
    )
    return result.text


def _explicit_chain(model: str, fallback_models: list[str] | None) -> list[Entry]:
    entries = []
    for ref in dict.fromkeys(m for m in [model, *(fallback_models or [])] if m):
        provider, _, name = ref.partition(":")
        if provider in PROVIDERS and name:
            entries.append(Entry(provider, name, guess_family(name)))
        else:
            entries.append(Entry("openrouter", ref, guess_family(ref)))
    return entries


def check_api_key(timeout: float = 8) -> tuple[bool, str]:
    """Ask the active tier's provider whether its key works. Costs no generation quota."""
    return PROVIDERS[tier()].check_key(timeout)
