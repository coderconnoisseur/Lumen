"""LUMEN API served by uvicorn: FastAPI in front, the Flask app mounted behind it.

    uvicorn asgi:app --workers 1

FastAPI routes (backend/api/) are matched first; every other path goes to Flask
unchanged, so each current URL resolves as before. CORS is decided once, here:
Flask-CORS's headers are dropped from mounted Flask responses so they can't be
sent twice. Auth, rate limits and the error body match Flask (api/deps.py,
api/errors.py; parity tests in tests/test_asgi.py).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from a2wsgi import WSGIMiddleware
from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app as flask_module
from api import agent, demo, documents, errors
from api.deps import llm_deadline
from config import Config

flask_app = flask_module.app


def _without_cors_headers(wsgi_app):
    """Drop Flask-CORS's response headers; CORSMiddleware sets them instead."""

    def strip(environ, start_response):
        def start(status, headers, exc_info=None):
            headers = [(k, v) for k, v in headers if not k.lower().startswith("access-control-")]
            return start_response(status, headers, exc_info)

        return wsgi_app(environ, start)

    return strip


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    flask_module.startup_checks()
    yield


def create_app(*routers: APIRouter) -> FastAPI:
    app = FastAPI(
        title="LUMEN Financial Intelligence API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=_lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=Config.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    errors.install(app)
    for router in routers:
        app.include_router(router, dependencies=[Depends(llm_deadline)])
    # Mounted last: Flask gets every path no FastAPI route claimed.
    app.mount("/", WSGIMiddleware(_without_cors_headers(flask_app)))
    return app


app = create_app(documents.router, agent.router, demo.router)
