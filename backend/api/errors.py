"""FastAPI error handlers that produce the Flask app's `{success:false, error, code}` body."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from api.deps import AuthFailed
from utils.errors import llm_error_status
from utils.llm import LLMError

logger = logging.getLogger(__name__)

# Routes that want their own wording catch LLMError themselves, as the Flask routes do.
LLM_MESSAGES = {
    "rate_limited": "Lumen's assistant is handling too many requests right now. Please try again in a minute.",
    "bad_response": "The assistant didn't return an answer. Please try again.",
    "unavailable": "Lumen's assistant is unavailable right now. Please try again shortly.",
}


def _error(message: str, status: int, code: str, headers=None) -> JSONResponse:
    return JSONResponse({"success": False, "error": message, "code": code}, status, headers=headers)


def install(app: FastAPI) -> None:
    @app.exception_handler(AuthFailed)
    async def auth_failed(_request: Request, e: AuthFailed):
        return JSONResponse(e.body, e.status)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, e: HTTPException):
        return _error(str(e.detail), e.status_code, "http_error", headers=e.headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, e: RequestValidationError):
        logger.info("invalid request: %s", e.errors())
        return _error("Invalid request", 422, "invalid_request")

    @app.exception_handler(LLMError)
    async def llm_error(request: Request, e: LLMError):
        status, code, key = llm_error_status(e)
        logger.error("%s: LLM %s: %s", request.url.path, e.kind, e.detail)
        return _error(LLM_MESSAGES[key], status, code)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, e: Exception):
        logger.error("API error (internal_error) on %s", request.url.path, exc_info=e)
        return _error("An internal error occurred", 500, "internal_error")
