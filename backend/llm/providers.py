"""Provider adapters: everything that differs between OpenRouter, Groq and Ollama.

All three speak the OpenAI chat-completions protocol, so the client builds one
request shape; an adapter only supplies the base URL, auth header, how to turn
model reasoning off, and how to check its key.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import requests

from config import Config
from llm.errors import LLMError

# Every configured free text model reasons by default (some at effort "high" or
# "xhigh"), and reasoning tokens count against max_tokens. With the small
# max_tokens our callers use, reasoning alone exhausts the budget and the reply
# comes back empty. Same prompt, reasoning off: 0.9s instead of tens of seconds.
# Off is the default for every call; pass reasoning=None to opt out.
REASONING_OFF = {"enabled": False}

_STATUS_KIND = {
    400: LLMError.CONFIG,
    401: LLMError.AUTH,
    402: LLMError.CREDITS,
    403: LLMError.CONFIG,  # model not available to this key (e.g. restricted access)
    404: LLMError.CONFIG,
    408: LLMError.UNAVAILABLE,
    429: LLMError.RATE_LIMITED,
}


def kind_for_status(status: int) -> str:
    if status in _STATUS_KIND:
        return _STATUS_KIND[status]
    return LLMError.UNAVAILABLE if status >= 500 else LLMError.BAD_RESPONSE


def error_message(body) -> str:
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        return str(err.get("message") or err)
    return str(err)


@dataclass(frozen=True)
class Provider:
    name: str
    default_base_url: str
    base_url_env: str
    key_env: str | None

    @property
    def base_url(self) -> str:
        return (os.getenv(self.base_url_env) or self.default_base_url).rstrip("/")

    @property
    def chat_url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def api_key(self) -> str | None:
        return os.getenv(self.key_env) if self.key_env else None

    def headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        key = self.api_key()
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return headers

    @staticmethod
    def kind_for_status(status: int) -> str:
        return kind_for_status(status)

    def reasoning_params(self, model: str, reasoning: dict | None) -> dict:
        """Extra request fields that apply `reasoning` (REASONING_OFF, a dict, or None)."""
        return {}

    def auth_hint(self) -> str:
        return f" Check {self.key_env} in backend/.env." if self.key_env else ""

    def check_key(self, timeout: float = 8) -> tuple[bool, str]:
        """Ask the provider whether the key works. Costs no generation quota."""
        try:
            resp = requests.get(f"{self.base_url}/models", headers=self.headers(), timeout=timeout)
        except requests.RequestException as e:
            return False, f"could not reach {self.name} ({type(e).__name__})."
        if resp.status_code != 200:
            return False, f"{self.name} rejected the key (HTTP {resp.status_code}: {_safe_message(resp)})."
        count = len((resp.json() or {}).get("data") or [])
        return True, f"{self.name} key OK ({count} models available)."


def _safe_message(resp) -> str:
    try:
        return error_message(resp.json())
    except ValueError:
        return resp.text[:120]


class _OpenRouter(Provider):
    def reasoning_params(self, model, reasoning):
        return {} if reasoning is None else {"reasoning": reasoning}

    def auth_hint(self) -> str:
        if "OPENROUTER_API_KEY" in Config.SHADOWED_ENV_KEYS:
            return (
                " OPENROUTER_API_KEY is set in your shell/system environment, which "
                "overrides backend/.env. Remove that variable or update it."
            )
        return " Check OPENROUTER_API_KEY in backend/.env."

    def check_key(self, timeout: float = 8) -> tuple[bool, str]:
        if not self.api_key():
            return False, "OPENROUTER_API_KEY is not set."
        try:
            resp = requests.get(f"{self.base_url}/key", headers=self.headers(), timeout=timeout)
        except requests.RequestException as e:
            return False, f"could not reach OpenRouter to verify the key ({type(e).__name__})."
        if resp.status_code != 200:
            return False, f"OpenRouter rejected the key (HTTP {resp.status_code}: {_safe_message(resp)}).{self.auth_hint()}"
        data = resp.json().get("data") or {}
        free = bool(data.get("is_free_tier"))
        # `limit_remaining` is the key's dollar credit, not a request count. The ~50/day cap on `:free` models
        # (no credits bought) isn't reported by this endpoint.
        remaining = data.get("limit_remaining")
        parts = ["free tier" if free else "paid"]
        if isinstance(remaining, (int, float)):
            parts.append(f"${remaining:.2f} of credit left")
        if free:
            parts.append("free models are limited per day")
        return True, f"OpenRouter key OK ({', '.join(parts)})."


class _Groq(Provider):
    # Only Groq's reasoning models accept these fields; others reject unknown
    # values, so send nothing for them. To be confirmed by the LLM-02 bench.
    def reasoning_params(self, model, reasoning):
        if reasoning != REASONING_OFF:
            return {}
        if "gpt-oss" in model:
            return {"reasoning_effort": "low"}  # gpt-oss can't switch reasoning off
        if "qwen3" in model:
            return {"reasoning_effort": "none"}
        return {}


class _Ollama(Provider):
    def reasoning_params(self, model, reasoning):
        return {"think": False} if reasoning == REASONING_OFF else {}


PROVIDERS: dict[str, Provider] = {
    "openrouter": _OpenRouter("openrouter", "https://openrouter.ai/api/v1", "OPENROUTER_BASE_URL", "OPENROUTER_API_KEY"),
    "groq": _Groq("groq", "https://api.groq.com/openai/v1", "GROQ_BASE_URL", "GROQ_API_KEY"),
    "ollama": _Ollama("ollama", "http://localhost:11434/v1", "OLLAMA_BASE_URL", None),
}
