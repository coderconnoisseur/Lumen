"""Users' own model keys (SPEC-BYOK): who the current request is for, and the chain their keys allow."""
from __future__ import annotations

import contextvars
import json
import logging
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from llm.errors import LLMError
from llm.registry import BYOK_PROVIDERS, Entry

logger = logging.getLogger(__name__)
KEY_ENV = "KEYS_ENCRYPTION_KEY"
KEY_ERRORS = frozenset({LLMError.AUTH, LLMError.CREDITS, LLMError.CONFIG})
PROVIDER_NAMES = {"openai": "OpenAI", "anthropic": "Anthropic", "gemini": "Gemini", "groq": "Groq",
                  "openrouter": "OpenRouter"}
_ctx: contextvars.ContextVar[dict | None] = contextvars.ContextVar("llm_user", default=None)


@contextmanager
def for_user(user_id: str, engine):
    token = _ctx.set({"user_id": str(user_id), "engine": engine, "rows": None, "ok": set()})
    try:
        yield
    finally:
        _ctx.reset(token)


def current():
    c = _ctx.get()
    return (c["user_id"], c["engine"]) if c else None


def _rows() -> list[tuple[str, str, dict]]:
    """(provider, decrypted key, {role: model}) for the current user; loaded once per request."""
    from models import UserKey
    from utils.crypto import decrypt_secret

    c = _ctx.get()
    if c is None:
        return []
    if c["rows"] is None:
        with Session(c["engine"]) as s:
            rows = s.scalars(select(UserKey).where(UserKey.user_id == c["user_id"])).all()
            out = []
            for r in rows:
                key = decrypt_secret(r.key_enc, key_env=KEY_ENV)
                if key.startswith("enc:"):  # encryption key changed: unusable, say so instead of sending it
                    logger.error("Stored %s key for a user can't be decrypted", r.provider)
                    continue
                out.append((r.provider, key, json.loads(r.models or "{}")))
        c["rows"] = sorted(out, key=lambda t: BYOK_PROVIDERS.index(t[0]) if t[0] in BYOK_PROVIDERS else 99)
    return c["rows"]


def user_chain(role: str) -> list[Entry]:
    from llm.client import registry

    chain: list[Entry] = []
    for provider, key, picks in _rows():
        listed = registry().byok(provider, role)
        pick = picks.get(role)
        listed.sort(key=lambda e: e.model != pick)  # the user's pick first, if it is still listed
        chain += [replace(e, key=key) for e in listed]
    return chain


def has_key(role: str) -> bool:
    return bool(user_chain(role))


def last4(key: str) -> str:
    return key[-4:] if key else ""


def mask(text: str, key: str) -> str:
    if not text or not key:
        return text
    text = text.replace(key, f"****{last4(key)}")
    # ponytail: O(n²) substring scan in the key length (keys are under 200 chars); use a regex if keys grow.
    for n in range(len(key) - 1, 7, -1):  # providers echo a prefix/suffix of the key
        for i in range(0, len(key) - n + 1):
            text = text.replace(key[i:i + n], "****")
    return text


def _set(engine, user_id: str, provider: str, **values) -> None:
    from models import UserKey

    with Session(engine) as s, s.begin():
        s.execute(update(UserKey).where(UserKey.user_id == user_id, UserKey.provider == provider).values(**values))


def mark_failed(provider: str, detail: str) -> None:
    c = _ctx.get()
    if c:
        _set(c["engine"], c["user_id"], provider, last_error=detail[:500])


def mark_ok(engine, user_id: str, provider: str) -> None:
    _set(engine, user_id, provider, last_ok_at=datetime.utcnow(), last_error=None)


def note_ok(provider: str) -> None:
    """mark_ok at most once per provider per context, so an agent loop doesn't write on every call."""
    c = _ctx.get()
    if c and provider not in c["ok"]:
        c["ok"].add(provider)
        mark_ok(c["engine"], c["user_id"], provider)


def failing(engine, user_id: str):
    from models import UserKey

    with Session(engine) as s:
        return s.scalars(select(UserKey).where(UserKey.user_id == user_id, UserKey.last_error.is_not(None))).all()
