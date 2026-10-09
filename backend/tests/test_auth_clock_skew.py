"""A token issued a few seconds "in the future" (server clocks differ) must still verify; a far-future one must not.
Found in the live demo: Supabase's clock was ahead of this machine's, so the fresh demo token was rejected (iat)."""
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec


@pytest.fixture
def sign(monkeypatch):
    import utils.auth as auth
    from config import Config

    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key())))
    monkeypatch.setattr(auth, "_expected_issuer", lambda: "https://x.supabase.co/auth/v1")
    monkeypatch.setattr(Config, "SUPABASE_JWT_AUD", "authenticated")

    def make(iat_offset):
        now = int(time.time())
        return jwt.encode({"sub": "u", "aud": "authenticated", "iss": "https://x.supabase.co/auth/v1",
                           "iat": now + iat_offset, "exp": now + 3600, "role": "authenticated"}, key, algorithm="ES256")
    return make


def test_small_clock_skew_is_accepted(sign):
    from utils.auth import verify_token

    assert verify_token(sign(20))["sub"] == "u"


def test_a_token_from_far_in_the_future_is_rejected(sign):
    from utils.auth import TokenError, verify_token

    with pytest.raises(TokenError):
        verify_token(sign(300))
