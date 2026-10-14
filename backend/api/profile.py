"""SPEC-ONBOARD: the signed-in user's profile (name, photo, currency, budget, use case, goals)."""
from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from api.deps import current_user, rate_limit

router = APIRouter(prefix="/api/profile", tags=["profile"])

Goal = Literal["save_more", "cut_subscriptions", "stay_on_budget", "pay_off_debt", "emergency_fund",
               "big_purchase", "business_expenses"]
DEMO_PROFILE = {"display_name": "Demo visitor", "avatar_key": None, "currency": "INR", "monthly_income": None,
                "monthly_budget": None, "use_case": "personal", "goals": ["save_more", "cut_subscriptions"],
                "onboarded": True, "demo": True}


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
