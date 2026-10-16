"""SPEC-ONBOARD: the signed-in user's profile (name, photo, currency, budget, use case, goals)."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/profile", tags=["profile"])

Goal = Literal["save_more", "cut_subscriptions", "stay_on_budget", "pay_off_debt", "emergency_fund",
               "big_purchase", "business_expenses"]
DEMO_PROFILE = {"display_name": "Demo visitor", "avatar_key": None, "currency": "INR", "monthly_income": 120000,
                "monthly_budget": 70000, "use_case": "personal",
                "goals": ["save_more", "cut_subscriptions", "big_purchase"], "onboarded": True, "demo": True}


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    from config import Config

    return create_engine(Config.DATABASE_URI, pool_pre_ping=True)


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=60)
    currency: str | None = Field(None, pattern=r"^[A-Z]{3}$")
    monthly_income: float | None = Field(None, ge=0, le=1e12)
    monthly_budget: float | None = Field(None, ge=0, le=1e12)
    use_case: Literal["personal", "household", "business"] | None = None
    goals: list[Goal] | None = None
    complete: bool = False


def _as_dict(user) -> dict:
    return {"display_name": user.display_name, "avatar_key": user.avatar_key, "currency": user.currency,
            "monthly_income": user.monthly_income, "monthly_budget": user.monthly_budget,
            "use_case": user.use_case, "goals": json.loads(user.goals or "[]"),
            "onboarded": user.onboarded_at is not None, "demo": False}


def _empty() -> dict:
    return {**{k: None for k in DEMO_PROFILE}, "goals": [], "onboarded": False, "demo": False}


def ensure_user(session: Session, user_id: str, email: str | None):
    """The users row, created on first write (same email fallback as api/review.py _record)."""
    from models import User

    user = session.get(User, user_id)
    if user is None:
        taken = email and session.scalar(select(User.id).where(User.email == email))
        user = User(id=user_id, email=email if email and not taken else f"{user_id}@users.lumen.local")
        session.add(user)
    return user


def load_profile(session: Session, user_id: str) -> dict | None:
    """The profile for personalisation (agent, insights), or None before onboarding is finished."""
    from models import User

    user = session.get(User, user_id)
    return _as_dict(user) if user is not None and user.onboarded_at is not None else None


def profile_for(engine: Engine, user_id: str) -> dict | None:
    """load_profile with its own session; a missing table or database error means no personalisation, not a failure."""
    try:
        with Session(engine) as session:
            return load_profile(session, user_id)
    except Exception as e:
        logger.warning("Profile unavailable for personalisation: %s", e)
        return None


@router.get("", dependencies=[Depends(rate_limit())])
def get_profile(claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    if claims.get("is_anonymous"):
        return {"success": True, "profile": DEMO_PROFILE}
    from models import User

    with Session(engine) as session:
        user = session.get(User, claims["sub"])
        return {"success": True, "profile": _as_dict(user) if user else _empty()}


@router.put("", dependencies=[Depends(rate_limit())])
def put_profile(body: ProfileUpdate, claims: dict = Depends(current_user), engine: Engine = Depends(get_engine)):
    if claims.get("is_anonymous"):
        raise HTTPException(403, "Demo accounts don't have a profile. Sign up to save yours.")
    with Session(engine) as session:
        user = ensure_user(session, claims["sub"], claims.get("email"))
        for field in ("display_name", "currency", "monthly_income", "monthly_budget", "use_case"):
            if field in body.model_fields_set:
                setattr(user, field, getattr(body, field))
        if "goals" in body.model_fields_set:
            user.goals = json.dumps(body.goals or [])
        if body.complete and user.onboarded_at is None:
            user.onboarded_at = datetime.utcnow()
        session.commit()
        return {"success": True, "profile": _as_dict(user)}


MAX_AVATAR_BYTES = 2 * 1024 * 1024
_MAGIC = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpg"}


def _image_ext(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return next((ext for magic, ext in _MAGIC.items() if data.startswith(magic)), None)


@router.put("/avatar", dependencies=[Depends(rate_limit("10 per minute"))])
def put_avatar(file: UploadFile = File(...), claims: dict = Depends(current_user),
               engine: Engine = Depends(get_engine)):
    from utils.files import get_store

    if claims.get("is_anonymous"):
        raise HTTPException(403, "Demo accounts don't have a profile. Sign up to save yours.")
    data = file.file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "That photo is over 2 MB. Choose a smaller one.")
    ext = _image_ext(data)
    if ext is None:
        raise HTTPException(415, "Use a PNG, JPEG or WebP photo.")
    key = f"{claims['sub']}/avatar-{int(time.time())}.{ext}"  # a new key each time, so caches never show the old one
    store = get_store()
    store.put(key, data)
    with Session(engine) as session:
        user = ensure_user(session, claims["sub"], claims.get("email"))
        old, user.avatar_key = user.avatar_key, key
        session.commit()
        profile = _as_dict(user)
    if old and old != key:
        store.delete(old)
    return {"success": True, "profile": profile}
