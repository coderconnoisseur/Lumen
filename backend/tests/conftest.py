import os
import socket
import sys
import tempfile
from pathlib import Path

import pytest

# Ensure the Lumen backend package wins over any other `app` on PYTHONPATH.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Tests must never write to the developer's real database or vector index.
# `config` reads these at import time and load_dotenv doesn't override them,
# so set them before any test imports the app. DATABASE_URL is set to empty
# (Config treats that as unset) rather than removed: removed, load_dotenv
# would fill it in from backend/.env.
TEST_DB_DIR = Path(tempfile.mkdtemp(prefix="lumen-tests-"))
os.environ["DATABASE_URL"] = ""
os.environ["DATABASE_PATH"] = str(TEST_DB_DIR / "lumen-test.db")
os.environ["ENABLE_CHROMA"] = "false"

# Provider keys are dummies, set before `config` loads backend/.env (which
# never overrides), so even an unmocked call can't spend the real free-tier
# quota: the network block below stops it, and the key would be rejected.
for _key in ("OPENROUTER_API_KEY", "GROQ_API_KEY"):
    os.environ[_key] = f"test-{_key.lower()}"

# Model chains come from llm/registry.yaml, not the developer's backend/.env.
# Empty means "unset" to the registry, and load_dotenv won't fill it back in.
for _key in (
    "LLM_TEXT_MODEL", "LLM_TEXT_FALLBACK_MODELS", "LLM_VISION_MODEL", "LLM_VISION_FALLBACK_MODELS",
    "LUMEN_LLM_TIER", "LUMEN_LLM_CACHE",
):
    os.environ[_key] = ""

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}
_real_connect = socket.socket.connect


def _guarded_connect(sock, address):
    host = address[0] if isinstance(address, tuple) else address
    if host not in _LOOPBACK:
        raise RuntimeError(f"network access is blocked in tests (tried {host!r})")
    return _real_connect(sock, address)


_real_getaddrinfo = socket.getaddrinfo


def _guarded_getaddrinfo(host, *args, **kwargs):
    if host is not None and host not in _LOOPBACK:
        raise RuntimeError(f"network access is blocked in tests (tried {host!r})")
    return _real_getaddrinfo(host, *args, **kwargs)


@pytest.fixture(autouse=True)
def _block_network(monkeypatch):
    """Fail any outbound connection except loopback (local service containers)."""
    monkeypatch.setattr(socket.socket, "connect", _guarded_connect)
    monkeypatch.setattr(socket, "getaddrinfo", _guarded_getaddrinfo)


@pytest.fixture
def authed_client(monkeypatch):
    """Test client whose requests are signed in as user-1 (token check mocked)."""
    import utils.auth
    from app import app

    monkeypatch.setattr(
        utils.auth,
        "verify_token",
        lambda token: {"sub": "user-1", "email": "u@example.com", "role": "authenticated"},
    )
    app.config.update({"TESTING": True})
    return app.test_client()
