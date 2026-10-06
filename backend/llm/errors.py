"""Typed LLM failures. Callers branch on `kind`, never on the message."""
from __future__ import annotations


class LLMError(RuntimeError):
    """The LLM provider could not produce an answer. Branch on `kind`, not the message."""

    AUTH = "auth"  # key missing, invalid or revoked (OpenRouter says "User not found.")
    CREDITS = "insufficient_credits"  # paid model and no credits left
    RATE_LIMITED = "rate_limited"  # per-minute or daily free-tier cap
    CONFIG = "config"  # bad request, e.g. a model id that no longer exists
    UNAVAILABLE = "unavailable"  # timeout, network error, provider 5xx
    BAD_RESPONSE = "bad_response"  # 2xx but nothing usable in it
    DEADLINE = "deadline"  # the request's time budget ran out before the call

    # These fail every later call in the same request too, so callers must not
    # paper over them with a fallback.
    FATAL = frozenset({AUTH, CREDITS, RATE_LIMITED, CONFIG, UNAVAILABLE, DEADLINE})

    def __init__(self, kind: str, detail: str, status: int | None = None):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail
        self.status = status

    @property
    def is_fatal(self) -> bool:
        return self.kind in self.FATAL
