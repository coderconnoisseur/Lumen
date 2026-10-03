"""The one place that calls an LLM (SPEC-LLM).

`complete()` walks a chain of (provider, model) entries for a role, from
llm/registry.yaml for the active tier (`LUMEN_LLM_TIER`, default openrouter):
  - RATE_LIMITED / UNAVAILABLE / CONFIG -> next entry (a short Retry-After that
    fits the request budget is waited out on the same entry first);
  - AUTH / CREDITS -> skip that provider for the rest of the call;
  - BAD_RESPONSE -> retry the same entry `retries` times, then raise (callers
    such as OCR count on a fixed number of requests per call);
  - DEADLINE -> stop: the request's time budget is spent.
Every attempt is cut to the request budget (llm/deadline.py) and can be
answered from, or recorded to, a cassette (llm/cassette.py).
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field

import requests

from llm import cassette
from llm.deadline import MARGIN_SECONDS, MIN_CALL_SECONDS, call_timeout, remaining, run_capped
from llm.errors import LLMError
from llm.providers import PROVIDERS, REASONING_OFF, error_message
from llm.registry import Entry, Registry

logger = logging.getLogger(__name__)

MAX_RETRY_AFTER_SECONDS = 5.0  # longer waits fail over instead
_sleep = time.sleep
_registry: Registry | None = None


@dataclass
class LLMResult:
    text: str
    tool_calls: list | None
    provider: str
    model: str
    usage: dict = field(default_factory=dict)
    latency_s: float = 0.0
    cached: bool = False
    finish_reason: str | None = None


def tier() -> str:
    return (os.getenv("LUMEN_LLM_TIER") or "openrouter").strip().lower()


def registry() -> Registry:
    global _registry
    if _registry is None:
        _registry = Registry.load()
    return _registry


def complete(
    messages: list[dict],
    *,
    role: str = "text",
    chain: list[Entry] | None = None,
    tools: list | None = None,
    response_format: dict | None = None,
    temperature: float = 0.0,
    max_tokens: int = 500,
    timeout: float = 30,
    retries: int = 1,
    reasoning: dict | None = REASONING_OFF,
    seed: int | None = None,
) -> LLMResult:
    entries = chain if chain is not None else registry().chain(tier(), role)
    if not entries:
        raise LLMError(LLMError.CONFIG, f"no models configured for role {role!r} in tier {tier()!r}")
    request = dict(tools=tools, response_format=response_format, temperature=temperature,
                   max_tokens=max_tokens, reasoning=reasoning, seed=seed)
    dead_providers: set[str] = set()
    last: LLMError | None = None
    for entry in entries:
        if entry.provider in dead_providers:
            continue
        try:
            return _complete_entry(entry, messages, request, timeout, retries)
        except LLMError as e:
            last = e
            if e.kind in (LLMError.DEADLINE, LLMError.BAD_RESPONSE):
                raise
            if e.kind in (LLMError.AUTH, LLMError.CREDITS):
                dead_providers.add(entry.provider)
            logger.warning("LLM %s:%s failed [%s]; trying the next model", entry.provider, entry.model, e.kind)
    raise last


def _complete_entry(entry: Entry, messages, request, timeout, retries) -> LLMResult:
    waited = False
    attempt = 0
    while True:
        try:
            return _call_once(entry, messages, request, timeout)
        except LLMError as e:
            if e.kind == LLMError.BAD_RESPONSE and attempt < retries:
                attempt += 1
                logger.info("Retrying LLM call after unusable reply: %s", e.detail)
                continue
            wait = getattr(e, "retry_after", None)
            if e.kind == LLMError.RATE_LIMITED and not waited and _fits(wait):
                waited = True
                _sleep(wait)
                continue
            raise


def _fits(wait: float | None) -> bool:
    if wait is None or wait > MAX_RETRY_AFTER_SECONDS:
        return False
    left = remaining()
    return left is None or wait + MIN_CALL_SECONDS + MARGIN_SECONDS <= left


def _call_once(entry: Entry, messages, request, timeout) -> LLMResult:
    provider = PROVIDERS[entry.provider]
    key = cassette.make_key(
        provider=entry.provider, model=entry.model, messages=messages, tools=request["tools"],
        response_format=request["response_format"], temperature=request["temperature"],
        max_tokens=request["max_tokens"], seed=request["seed"],
    )
    mode = cassette.mode()
    shelf = tier()
    if mode != "off":
        hit = cassette.lookup(shelf, key)
        if hit is not None:
            return _from_entry(hit, cached=True)
        if mode == "replay":
            raise cassette.CassetteMiss(suite=cassette.current_suite(), key=key, case=cassette.current_case())

    payload = {"model": entry.model, "messages": messages,
               "temperature": request["temperature"], "max_tokens": request["max_tokens"]}
    for name in ("tools", "response_format", "seed"):
        if request[name] is not None:
            payload[name] = request[name]
    payload.update(provider.reasoning_params(entry.model, request["reasoning"]))

    slice_s = call_timeout(timeout)
    start = time.monotonic()
    try:
        resp = run_capped(
            lambda: requests.post(provider.chat_url, headers=provider.headers(), json=payload, timeout=slice_s),
            seconds=slice_s,
        )
    except requests.Timeout as e:
        raise LLMError(LLMError.UNAVAILABLE, f"{provider.name} timed out after {slice_s:.1f}s") from e
    except requests.RequestException as e:
        raise LLMError(LLMError.UNAVAILABLE, f"{provider.name} request failed: {e}") from e
    latency = time.monotonic() - start

    result = _parse(provider, entry, resp, latency, request["max_tokens"])
    if mode == "record":
        cassette.record(shelf, key, _to_entry(result))
    return result


def _parse(provider, entry: Entry, resp, latency: float, max_tokens: int) -> LLMResult:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    if resp.status_code != 200 or "error" in body:
        # OpenRouter occasionally reports errors with HTTP 200 and an error body.
        status = resp.status_code
        if status == 200 and isinstance(body.get("error"), dict):
            status = int(body["error"].get("code") or 502)
        kind = provider.kind_for_status(status)
        detail = f"{provider.name} HTTP {status} (model={entry.model}): {error_message(body) or resp.text[:200]}"
        if kind == LLMError.AUTH:
            detail += provider.auth_hint()
        logger.error("LLM call failed [%s]: %s after %.1fs", kind, detail, latency)
        err = LLMError(kind, detail, status=status)
        err.retry_after = _retry_after(resp)
        raise err

    served = body.get("model") or entry.model
    choice = _dict((body.get("choices") or [None])[0] if isinstance(body.get("choices"), list) else None)
    usage = _dict(body.get("usage"))
    details = _dict(usage.get("completion_tokens_details"))
    finish_reason = choice.get("finish_reason")
    reasoning_tokens = details.get("reasoning_tokens")
    logger.info(
        "LLM %s served=%s latency=%.1fs finish=%s tokens(prompt=%s, completion=%s, reasoning=%s) provider=%s cached=False",
        entry.model, served, latency, finish_reason, usage.get("prompt_tokens"),
        usage.get("completion_tokens"), reasoning_tokens, provider.name,
    )

    message = choice.get("message")
    if not isinstance(message, dict):
        raise LLMError(LLMError.BAD_RESPONSE, f"Unexpected {provider.name} response shape: no message")
    content = message.get("content") or ""
    tool_calls = message.get("tool_calls") or None
    if not content.strip() and not tool_calls:
        if finish_reason == "length":
            raise LLMError(
                LLMError.BAD_RESPONSE,
                f"{served} hit max_tokens={max_tokens} before writing any output "
                f"(reasoning_tokens={reasoning_tokens})",
            )
        raise LLMError(LLMError.BAD_RESPONSE, f"Empty completion from {served}")
    return LLMResult(
        text=content.strip(), tool_calls=tool_calls, provider=provider.name, model=served,
        usage={"prompt": usage.get("prompt_tokens"), "completion": usage.get("completion_tokens"),
               "reasoning": reasoning_tokens},
        latency_s=round(latency, 3), cached=False, finish_reason=finish_reason,
    )


def _dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _retry_after(resp) -> float | None:
    raw = (getattr(resp, "headers", None) or {}).get("Retry-After")
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def _to_entry(result: LLMResult) -> dict:
    return {"provider": result.provider, "model": result.model, "text": result.text,
            "tool_calls": result.tool_calls, "finish_reason": result.finish_reason,
            "usage": result.usage, "latency_s": result.latency_s}


def _from_entry(entry: dict, *, cached: bool) -> LLMResult:
    result = LLMResult(
        text=entry["text"], tool_calls=entry.get("tool_calls"), provider=entry["provider"],
        model=entry["model"], usage=entry.get("usage") or {}, latency_s=entry.get("latency_s", 0.0),
        cached=cached, finish_reason=entry.get("finish_reason"),
    )
    logger.info("LLM %s served=%s latency=%.1fs finish=%s provider=%s cached=True",
                result.model, result.model, result.latency_s, result.finish_reason, result.provider)
    return result
