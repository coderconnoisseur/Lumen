"""Safe API error responses — never leak stack traces or internals to clients."""
from __future__ import annotations

import logging
from typing import Any

from flask import jsonify

logger = logging.getLogger(__name__)


def api_error(
    message: str,
    *,
    status: int = 500,
    code: str = "internal_error",
    log: Exception | str | None = None,
) -> tuple[Any, int]:
    """Return a generic JSON error and log details server-side."""
    if log is not None:
        if isinstance(log, Exception):
            logger.exception("API error (%s): %s", code, log)
        else:
            logger.error("API error (%s): %s", code, log)
    return jsonify({"success": False, "error": message, "code": code}), status


def llm_api_error(e, messages: dict[str, str], *, context: str = "") -> tuple[Any, int]:
    """Turn a `utils.llm.LLMError` into a client response.

    Rate limits are 429 and an unusable reply is 502; everything else (dead
    key, no credits, retired model, provider down) is 503. Never 401: the
    frontend treats 401 as "session expired" and signs the user out. `messages`
    maps "rate_limited", "bad_response" and "unavailable" to user-facing text;
    operator detail (which key, which model) goes only to the server log.
    """
    status, code, key = llm_error_status(e)
    logger.error("%sLLM %s: %s", f"{context}: " if context else "", e.kind, e.detail)
    return api_error(messages[key], status=status, code=code)


def llm_error_status(e) -> tuple[int, str, str]:
    """(HTTP status, error code, message key) for an LLMError; shared with FastAPI."""
    from utils.llm import LLMError

    if e.kind == LLMError.RATE_LIMITED:
        return 429, "llm_rate_limited", "rate_limited"
    if e.kind == LLMError.BAD_RESPONSE:
        return 502, "llm_bad_response", "bad_response"
    return 503, "llm_unavailable", "unavailable"
