"""Symmetric encryption for secrets at rest (e.g. IMAP passwords)."""
from __future__ import annotations

import base64
import hashlib
import logging
import os

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_PREFIX = "enc:"


def _fernet(key_env: str = "EMAIL_ENCRYPTION_KEY") -> Fernet | None:
    raw = os.getenv(key_env) or os.getenv("SECRET_KEY")
    if not raw:
        return None
    # Fernet needs a 32-byte url-safe base64 key; derive deterministically.
    digest = hashlib.sha256(raw.encode()).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(plaintext: str, *, key_env: str = "EMAIL_ENCRYPTION_KEY") -> str:
    if not plaintext:
        return plaintext
    f = _fernet(key_env)
    if f is None:
        logger.warning("%s/SECRET_KEY missing — storing secret in plaintext", key_env)
        return plaintext
    token = f.encrypt(plaintext.encode()).decode()
    return f"{_PREFIX}{token}"


def decrypt_secret(stored: str, *, key_env: str = "EMAIL_ENCRYPTION_KEY") -> str:
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        return stored
    f = _fernet(key_env)
    if f is None:
        logger.warning("Cannot decrypt secret — encryption key missing")
        return stored
    try:
        return f.decrypt(stored[len(_PREFIX) :].encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt stored secret — wrong encryption key?")
        return stored
