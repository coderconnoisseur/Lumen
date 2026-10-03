"""The test suite must never reach a real LLM provider or use a real key."""
import os
import socket

import pytest


def test_outbound_connection_is_blocked():
    with pytest.raises(RuntimeError, match="network access is blocked"):
        socket.create_connection(("openrouter.ai", 443), timeout=1)


def test_requests_cannot_reach_the_internet():
    import requests

    with pytest.raises(Exception) as excinfo:
        requests.post("https://openrouter.ai/api/v1/chat/completions", json={}, timeout=1)
    assert "network access is blocked" in str(excinfo.value)


def test_loopback_is_still_allowed():
    # Local services (a Postgres service container in CI) must stay reachable.
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        with socket.create_connection(server.getsockname(), timeout=1):
            pass


@pytest.mark.parametrize("key", ["OPENROUTER_API_KEY", "GROQ_API_KEY"])
def test_provider_keys_are_dummies(key):
    assert os.environ[key].startswith("test-")


def test_config_sees_the_dummy_key():
    from config import Config

    assert Config.OPENROUTER_API_KEY.startswith("test-")
