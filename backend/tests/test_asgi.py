"""API-01: FastAPI outer app with the Flask app mounted (SPEC-LLM, parity rule).

Each parity point runs against one Flask route (reached through `asgi:app`) and
one FastAPI route (a test router passed to `create_app`).
"""
import jwt
import pytest
from fastapi import APIRouter, Depends, HTTPException

PARITY_ORIGIN = "http://localhost:3000"  # Config.ALLOWED_ORIGINS default
# Owned by CORSMiddleware once mounted, or per-request noise.
NOT_COMPARED = {"date", "server", "vary"}


def bearer(sub):
    """A JWT whose `sub` the rate limiter reads (fake_verify below accepts it)."""
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


def _comparable(headers):
    return sorted(
        (k.lower(), v)
        for k, v in headers.items()
        if k.lower() not in NOT_COMPARED and not k.lower().startswith("access-control-")
    )


@pytest.fixture
def limiter_reset():
    import app  # noqa: F401  (limiter.init_app creates the storage)
    from utils.limiter import limiter

    limiter.reset()
    yield limiter
    limiter.reset()


def _test_router():
    from api.deps import current_user, rate_limit
    from utils.llm import LLMError

    router = APIRouter()

    @router.get("/api/test/me", dependencies=[Depends(rate_limit())])
    def me(claims: dict = Depends(current_user)):
        return {"id": claims["sub"]}

    @router.get("/api/test/tight", dependencies=[Depends(rate_limit("2 per minute"))])
    def tight():
        return {"ok": True}

    @router.get("/api/test/boom")
    def boom():
        raise RuntimeError("secret internals")

    @router.get("/api/test/forbidden")
    def forbidden():
        raise HTTPException(403, "nope")

    @router.get("/api/test/llm/{kind}")
    def llm_fail(kind: str):
        raise LLMError(kind, "operator detail")

    @router.get("/api/test/deadline")
    def deadline_left():
        from llm.deadline import remaining

        return {"remaining": remaining()}

    return router


@pytest.fixture
def asgi_client(limiter_reset):
    from fastapi.testclient import TestClient

    from asgi import create_app

    return TestClient(create_app(_test_router()), raise_server_exceptions=False)


@pytest.fixture
def flask_client(limiter_reset):
    from app import app

    app.config.update({"TESTING": True})
    return app.test_client()


@pytest.fixture
def signed_in(monkeypatch):
    import utils.auth

    def fake_verify(token):
        if token == "bad":
            raise utils.auth.TokenError("malformed_token", "junk")
        sub = jwt.decode(token, options={"verify_signature": False})["sub"]
        return {"sub": sub, "email": f"{sub}@example.com", "role": "authenticated"}

    monkeypatch.setattr(utils.auth, "verify_token", fake_verify)


def test_startup_runs_the_same_checks_as_python_app_py(monkeypatch, limiter_reset):
    from fastapi.testclient import TestClient

    import app as flask_module
    from asgi import create_app

    calls = []
    monkeypatch.setattr(flask_module, "startup_checks", lambda: calls.append("checked"))
    with TestClient(create_app()):  # entering runs the lifespan
        pass
    assert calls == ["checked"]


def test_module_exposes_the_served_app():
    from fastapi import FastAPI

    import asgi

    assert isinstance(asgi.app, FastAPI)


# --- Flask routes reach Flask unchanged -------------------------------------


@pytest.mark.parametrize(
    "method, path, kwargs",
    [
        ("get", "/health", {}),
        ("get", "/", {}),
        ("post", "/chat", {"json": {"query": "hi"}}),  # 401
        ("get", "/no-such-route", {}),  # Flask's 404 body
        ("put", "/health", {}),  # Flask's 405 body
    ],
)
def test_flask_routes_are_byte_identical_through_asgi(
    asgi_client, flask_client, limiter_reset, monkeypatch, method, path, kwargs
):
    monkeypatch.setattr(limiter_reset, "enabled", False)
    direct = getattr(flask_client, method)(path, **kwargs)
    mounted = getattr(asgi_client, method)(path, **kwargs)

    assert mounted.status_code == direct.status_code
    assert mounted.content == direct.data
    assert _comparable(mounted.headers) == _comparable(direct.headers)


# --- Auth --------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/v1/auth/me", "/api/test/me"])
@pytest.mark.parametrize(
    "headers, status, body",
    [
        ({}, 401, {"error": "unauthorized", "code": "missing_token"}),
        ({"Authorization": "Token abc"}, 401, {"error": "unauthorized", "code": "missing_token"}),
        ({"Authorization": "Bearer bad"}, 401, {"error": "unauthorized", "code": "malformed_token"}),
    ],
)
def test_auth_failures_match(asgi_client, signed_in, path, headers, status, body):
    r = asgi_client.get(path, headers=headers)
    assert r.status_code == status
    assert r.json() == body


@pytest.mark.parametrize("path", ["/api/v1/auth/me", "/api/test/me"])
def test_auth_misconfigured_matches(asgi_client, monkeypatch, path):
    import utils.auth

    def no_config(token):
        raise utils.auth.AuthConfigError("SUPABASE_URL is not set")

    monkeypatch.setattr(utils.auth, "verify_token", no_config)
    r = asgi_client.get(path, headers={"Authorization": "Bearer x"})
    assert r.status_code == 500
    assert r.json() == {"error": "auth_misconfigured"}


@pytest.mark.parametrize("path", ["/api/v1/auth/me", "/api/test/me"])
def test_valid_token_reaches_the_handler(asgi_client, signed_in, path):
    r = asgi_client.get(path, headers=bearer("alice"))
    assert r.status_code == 200
    assert r.json()["id"] == "alice"


# --- Rate limits --------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/v1/auth/me", "/api/test/me"])
def test_default_limit_and_429_body_match(asgi_client, signed_in, path):
    auth = bearer("alice")
    for i in range(60):
        r = asgi_client.get(path, headers=auth)
        assert r.status_code == 200, i
    assert r.headers["X-RateLimit-Limit"] == "60"
    assert r.headers["X-RateLimit-Remaining"] == "0"

    r = asgi_client.get(path, headers=auth)
    assert r.status_code == 429
    assert r.json() == {"success": False, "error": "60 per 1 minute", "code": "http_error"}
    for header in ("X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"):
        assert header in r.headers
    assert 0 < int(r.headers["Retry-After"]) <= 60

    # The bucket is per user: someone else on the same IP is unaffected.
    assert asgi_client.get(path, headers=bearer("bob")).status_code == 200


def test_fastapi_limit_uses_flask_limiter_storage(asgi_client, limiter_reset):
    assert asgi_client.get("/api/test/tight").status_code == 200
    assert asgi_client.get("/api/test/tight").status_code == 200
    assert asgi_client.get("/api/test/tight").status_code == 429

    limiter_reset.reset()  # clears Flask-Limiter's storage, so it clears ours too
    assert asgi_client.get("/api/test/tight").status_code == 200


def test_fastapi_limit_honours_the_disabled_switch(asgi_client, limiter_reset, monkeypatch):
    monkeypatch.setattr(limiter_reset, "enabled", False)
    for _ in range(3):
        assert asgi_client.get("/api/test/tight").status_code == 200


# --- CORS --------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/chat", "/api/test/me"])
def test_preflight_from_allowed_origin(asgi_client, path):
    r = asgi_client.options(path, headers={
        "Origin": PARITY_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == PARITY_ORIGIN
    assert r.headers["access-control-allow-credentials"] == "true"
    assert "POST" in r.headers["access-control-allow-methods"]
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize("path", ["/chat", "/api/test/me"])
def test_preflight_from_other_origin_is_not_allowed(asgi_client, path):
    r = asgi_client.options(path, headers={
        "Origin": "https://evil.example",
        "Access-Control-Request-Method": "POST",
    })
    assert "access-control-allow-origin" not in r.headers


@pytest.mark.parametrize("path", ["/health", "/api/test/tight"])
def test_cors_headers_are_sent_once(asgi_client, path):
    r = asgi_client.get(path, headers={"Origin": PARITY_ORIGIN})
    assert r.headers.get_list("access-control-allow-origin") == [PARITY_ORIGIN]
    assert r.headers.get_list("access-control-allow-credentials") == ["true"]

    other = asgi_client.get(path, headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in other.headers


# --- Error body ----------------------------------------------------------------


def test_unexpected_error_body_matches_flask(asgi_client):
    r = asgi_client.get("/api/test/boom")
    assert r.status_code == 500
    assert r.json() == {"success": False, "error": "An internal error occurred", "code": "internal_error"}
    assert "secret" not in r.text


@pytest.mark.parametrize(
    "kind, status, code",
    [
        ("rate_limited", 429, "llm_rate_limited"),
        ("bad_response", 502, "llm_bad_response"),
        ("unavailable", 503, "llm_unavailable"),
        ("deadline", 503, "llm_unavailable"),
    ],
)
def test_llm_errors_map_like_flask(asgi_client, kind, status, code):
    from utils.llm import LLMError

    assert getattr(LLMError, kind.upper()) == kind
    r = asgi_client.get(f"/api/test/llm/{kind}")
    assert r.status_code == status
    body = r.json()
    assert body["success"] is False and body["code"] == code
    assert "operator detail" not in r.text


def test_fastapi_http_errors_use_the_flask_shape(asgi_client):
    r = asgi_client.get("/api/test/forbidden")
    assert r.status_code == 403
    assert r.json() == {"success": False, "error": "nope", "code": "http_error"}


def test_unknown_paths_fall_through_to_flask(asgi_client, flask_client):
    r = asgi_client.get("/api/test/llm")  # no FastAPI route matches
    assert r.status_code == 404
    assert r.content == flask_client.get("/api/test/llm").data


def test_fastapi_validation_errors_use_the_error_shape(limiter_reset):
    from fastapi.testclient import TestClient

    from asgi import create_app

    router = APIRouter()

    @router.get("/api/test/n")
    def n(n: int):
        return {"n": n}

    r = TestClient(create_app(router)).get("/api/test/n", params={"n": "x"})
    assert r.status_code == 422
    assert r.json() == {"success": False, "error": "Invalid request", "code": "invalid_request"}


# --- Request deadline -----------------------------------------------------------


def test_fastapi_routes_run_under_the_request_deadline(asgi_client):
    left = asgi_client.get("/api/test/deadline").json()["remaining"]
    assert left is not None and 90 < left <= 100
