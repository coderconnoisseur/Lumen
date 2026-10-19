"""SPEC-BYOK: a user's own model keys: add (validated, encrypted), list (last 4 only), test and remove."""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit
from api.profile import get_engine
from llm import keys
from llm.registry import BYOK_PROVIDERS
from utils.crypto import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api/keys", tags=["keys"])
ROLES = ("agent", "text", "vision")
PROVIDERS_ALL = (*BYOK_PROVIDERS, "tavily")  # tavily: web search only, no models


class KeyIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    key: str = Field(min_length=8, max_length=400)
    models: dict[str, str] | None = None


def _catalogue(provider: str) -> dict[str, list[str]]:
    from llm.client import registry

    if provider == "tavily":
        return {}
    return {role: [e.model for e in registry().byok(provider, role)] for role in ROLES}


def _provider(provider: str) -> str:
    if provider not in PROVIDERS_ALL:
        raise HTTPException(404, "Unknown provider.")
    return provider


def _row(session: Session, user_id: str, provider: str):
    from models import UserKey

    return session.scalars(select(UserKey).where(UserKey.user_id == user_id, UserKey.provider == provider)).first()


def _key(row) -> str | None:
    """The decrypted key, or None when it can't be decrypted (the encryption key changed)."""
    key = decrypt_secret(row.key_enc, key_env=keys.KEY_ENV)
    return None if key.startswith("enc:") else key


def _public(row) -> dict:
    """What the UI may see about a stored key: never the key itself."""
    return {"last4": keys.last4(_key(row) or ""), "created_at": row.created_at, "last_ok_at": row.last_ok_at,
            "last_error": row.last_error, "models": json.loads(row.models or "{}")}


def _check(provider: str, key: str) -> tuple[bool, str]:
    from agent.tools import check_tavily_key
    from llm.providers import PROVIDERS

    return check_tavily_key(key) if provider == "tavily" else PROVIDERS[provider].check_key(key=key)


def _fail(status: int, message: str, code: str) -> JSONResponse:
    return JSONResponse({"success": False, "error": message, "code": code}, status)


@router.get("", dependencies=[Depends(rate_limit())])
def list_keys(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    from models import UserKey

    with Session(engine) as s:
        rows = {r.provider: r for r in s.scalars(select(UserKey).where(UserKey.user_id == claims["sub"]))}
        providers = [{"provider": p, "name": keys.PROVIDER_NAMES[p], "models": _catalogue(p),
                      "key": _public(rows[p]) if p in rows else None} for p in PROVIDERS_ALL]
    with keys.for_user(claims["sub"], engine):
        in_use = {}
        for role in ROLES:
            chain = keys.user_chain(role)
            in_use[role] = f"{chain[0].provider}:{chain[0].model}" if chain else "platform"
    return {"success": True, "providers": providers, "in_use": in_use}


@router.put("/{provider}", dependencies=[Depends(rate_limit("5 per minute"))])
def put_key(provider: str, body: KeyIn, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    from models import UserKey

    if claims.get("is_anonymous"):
        raise HTTPException(403, "Demo accounts can't save keys. Sign up to add yours.")
    catalogue = _catalogue(_provider(provider))
    picks = body.models or {}
    if any(model not in catalogue.get(role, []) for role, model in picks.items()):
        raise HTTPException(422, "That model isn't offered for this provider.")
    key_enc = encrypt_secret(body.key, key_env=keys.KEY_ENV)
    if not key_enc.startswith("enc:"):
        return _fail(503, "Saving keys isn't available right now.", "keys_unavailable")
    ok, message = _check(provider, body.key)
    if not ok:
        return _fail(400, keys.mask(message, body.key), "key_invalid")
    with Session(engine) as s:
        row = _row(s, claims["sub"], provider)
        if row is None:
            row = UserKey(user_id=claims["sub"], provider=provider)
            s.add(row)
        row.key_enc, row.models = key_enc, json.dumps(picks) if picks else None
        row.last_ok_at, row.last_error = datetime.utcnow(), None
        s.commit()
        return {"success": True, "key": _public(row)}


@router.post("/{provider}/test", dependencies=[Depends(rate_limit("5 per minute"))])
def test_key(provider: str, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    with Session(engine) as s:
        row = _row(s, claims["sub"], _provider(provider))
        if row is None:
            raise HTTPException(404, "No key saved for this provider.")
        key = _key(row)
        ok, message = _check(provider, key) if key else (False, keys.UNREADABLE_DETAIL)
        message = keys.mask(message, key)
        if not ok:
            row.last_error = message[:500]
            s.commit()
    if ok:
        keys.mark_ok(engine, claims["sub"], provider)
    return {"success": ok, "message": message}


@router.delete("/{provider}", dependencies=[Depends(rate_limit())])
def delete_key(provider: str, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    with Session(engine) as s:
        row = _row(s, claims["sub"], _provider(provider))
        if row is None:
            raise HTTPException(404, "No key saved for this provider.")
        s.delete(row)
        s.commit()
    return {"success": True}
