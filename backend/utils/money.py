"""Money in the user's currency for AI insight text and prompts (SPEC-ONBOARD).

The profile lives on `users` (api/profile.py); before onboarding, or for demo accounts, amounts fall back to
`Config.DEFAULT_CURRENCY` (INR). ponytail: no exchange rates; amounts are assumed to be in the profile currency.
"""
from __future__ import annotations

from config import Config

_SYMBOL = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}


def fmt(amount: float | None, currency: str | None) -> str:
    """₹1,234 / $5 / CHF 1,234 / -₹500 (whole units: insight text, not accounting). A missing amount is 0."""
    code = (currency or Config.DEFAULT_CURRENCY).upper()
    value = float(amount or 0)
    sign, number = ("-" if value < 0 else ""), f"{abs(value):,.0f}"
    sym = _SYMBOL.get(code)
    return f"{sign}{sym}{number}" if sym else f"{sign}{code} {number}"


def _user(user_id: str):
    from models import User
    from models.database import db

    try:
        return db.session.get(User, str(user_id))
    except Exception:  # no Flask context or no table yet: no personalisation
        return None


def user_currency(user_id: str) -> str:
    user = _user(user_id)
    return (user.currency if user is not None and user.currency else None) or Config.DEFAULT_CURRENCY


def user_budget(user_id: str) -> float | None:
    user = _user(user_id)
    return user.monthly_budget if user is not None else None


def user_income(user_id: str) -> float | None:
    user = _user(user_id)
    return user.monthly_income if user is not None else None
