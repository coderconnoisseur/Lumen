"""FastAPI dependencies that behave exactly like the Flask side (SPEC-LLM, API-01 parity rule).

- `current_user`: the same `utils.auth.verify_token`, the same 401/500 bodies as `@require_auth`.
- `rate_limit(spec)`: the same per-user key, the same default limit and the same storage as
  Flask-Limiter, so `limiter.reset()` and `limiter.enabled` apply to both.
- `llm_deadline`: the same per-request LLM budget as `llm.deadline.install_flask`.
"""
from __future__ import annotations

import time

from fastapi import HTTPException, Request, Response
from limits import parse

import utils.auth
from llm.deadline import request_deadline
from utils.limiter import limiter, rate_limit_key

DEFAULT_LIMIT = "60 per minute"  # Flask-Limiter's default_limits in utils/limiter.py


class AuthFailed(Exception):
    """Rendered as-is by api/errors.py: `require_auth` bodies have no `success` field."""

    def __init__(self, status: int, body: dict):
        super().__init__(body)
        self.status = status
        self.body = body


def current_user(request: Request) -> dict:
    """The verified JWT claims for the request, or AuthFailed."""
    token = utils.auth.parse_bearer(request.headers.get("Authorization", ""))
    if token is None:
        utils.auth.logger.info("auth: missing or malformed Authorization header on %s", request.url.path)
        raise AuthFailed(401, {"error": "unauthorized", "code": "missing_token"})
    try:
        return utils.auth.verify_token(token)
    except utils.auth.TokenError as e:
        utils.auth.logger.info("auth: rejected token on %s (%s: %s)", request.url.path, e.code, e.detail)
        raise AuthFailed(401, {"error": "unauthorized", "code": e.code})
    except utils.auth.AuthConfigError as e:
        utils.auth.logger.error("auth: %s", e)
        raise AuthFailed(500, {"error": "auth_misconfigured"})


def rate_limit(spec: str = DEFAULT_LIMIT):
    """A dependency that counts the request against `spec`, per user and per route."""
    item = parse(spec)

    def check(request: Request, response: Response) -> None:
        if not limiter.enabled:
            return
        client = request.client.host if request.client else "127.0.0.1"
        key = rate_limit_key(request.headers.get("Authorization", ""), client)
        route = request.scope.get("route")
        scope = f"fastapi:{route.path if route else request.url.path}"

        allowed = limiter.limiter.hit(item, key, scope)
        reset_at, remaining = limiter.limiter.get_window_stats(item, key, scope)
        headers = {
            "X-RateLimit-Limit": str(item.amount),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(int(reset_at)),
            "Retry-After": str(int(reset_at - time.time())),
        }
        if not allowed:
            # Same body as Flask's 429: the limit's text, e.g. "60 per 1 minute".
            raise HTTPException(429, str(item), headers=headers)
        response.headers.update(headers)

    return check


async def llm_deadline():
    """Budget every FastAPI request's LLM calls; sync handlers inherit it in the threadpool."""
    with request_deadline():
        yield
