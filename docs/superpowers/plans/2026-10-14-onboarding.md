# Onboarding and Personalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New accounts answer a 3-step onboarding once; Lumen then uses their name, photo, currency, budget, use case
and goals across the app and its AI.

**Architecture:** Profile fields are nullable columns on the existing `users` table (startup `_ADDED_COLUMNS`
migration). A FastAPI router `api/profile.py` reads and writes them and stores the photo through `utils/files`. The
frontend loads the profile once in a `ProfileProvider` inside `app/(app)/layout.tsx`, which also sends
not-yet-onboarded accounts to `/onboarding`. Personalisation reads the same profile: a `formatMoney` helper in the
UI, and an optional `profile` on the agent's `ToolContext` and in the insight prompts.

**Tech Stack:** Flask-SQLAlchemy models, FastAPI + Pydantic, pytest; Next.js 14 app router, React 18, Tailwind 4.

**Spec:** `docs/direction/specs/SPEC-ONBOARD.md`

## Global Constraints
- Columns are all nullable and added through `_ADDED_COLUMNS` (`backend/models/database.py`); no Alembic revision.
- `display_name` 1-60 characters; `currency` matches `^[A-Z]{3}$`; `monthly_income`/`monthly_budget` 0-10¹² or null;
  `use_case` ∈ `personal|household|business`; `goals` ⊆ `save_more, cut_subscriptions, stay_on_budget, pay_off_debt,
  emergency_fund, big_purchase, business_expenses`.
- Avatar: PNG/JPEG/WebP by content (magic bytes), ≤ 2 MB, key `{user_id}/avatar-{unix_seconds}.{ext}`; the previous
  avatar file is deleted on change. Served by the existing `GET /api/files/{key}`.
- Demo (anonymous) accounts: `GET` returns the fixed demo profile, `PUT` returns 403, onboarding never shows.
- Agent prompt: with no profile, `system_prompt` returns exactly today's text (recorded evals stay valid).
- UI copy is sentence case, "…" not "...", inputs 16px, loading buttons keep their label (Vercel guidelines, #56).
- No exchange-rate conversion (spec: ponytail note).

## Review Focus
1. A user whose email already belongs to another `users` row (e.g. signed up twice): the profile row must still be
   created (fallback email), not 500. → Task 1 test `test_put_creates_row_when_email_taken`.
2. A user refreshes or closes the tab mid-onboarding: they resume at the step in the URL with earlier answers kept.
   → Task 4 manual check, step 4.
3. A user uploads a photo twice: the old file is deleted and the sidebar shows the new one (no stale cache).
   → Task 2 test `test_second_upload_replaces_and_deletes_the_first`.
4. A transaction with its own currency (e.g. CHF) for an INR user shows CHF, not ₹. → Task 5 check, step 3.
5. A signed-up user who never finishes onboarding opens `/dashboard` directly: sent to `/onboarding`, and after
   finishing lands on `/dashboard`. → Task 3 manual check, step 4.

---

## ONB-01: profile data and API (PR 1)

### Task 1: profile columns, model and GET/PUT

**Files:**
- Modify: `backend/models/__init__.py` (class `User`)
- Modify: `backend/models/database.py` (`_ADDED_COLUMNS`)
- Create: `backend/api/profile.py`
- Modify: `backend/asgi.py` (register router)
- Test: `backend/tests/test_api_profile.py`

**Interfaces:**
- Produces: `GET /api/profile` → `{"success": true, "profile": Profile}`; `PUT /api/profile` (body `ProfileUpdate`)
  → same shape. `Profile = {display_name: str|null, avatar_key: str|null, currency: str|null, monthly_income:
  float|null, monthly_budget: float|null, use_case: str|null, goals: list[str], onboarded: bool, demo: bool}`.
- Produces (Python): `api.profile.load_profile(session, user_id) -> dict | None` (None when no row or not onboarded),
  used by Tasks 6-7.

- [ ] **Step 1: Write the failing tests**

```python
"""SPEC-ONBOARD: the profile API."""
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

USER = "7a1c0000-0000-4000-8000-000000000001"
OTHER = "7a1c0000-0000-4000-8000-000000000002"


def bearer(sub, anonymous=False, email="me@example.com"):
    claims = {"sub": sub, "is_anonymous": anonymous, "email": email}
    return {"Authorization": "Bearer " + jwt.encode(claims, "k" * 32, algorithm="HS256")}


@pytest.fixture
def client(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import profile
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    engine = create_engine(f"sqlite:///{tmp_path / 'p.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(profile.router)
    app.dependency_overrides[profile.get_engine] = lambda: engine
    limiter.reset()
    return TestClient(app), engine


def test_get_without_a_row_is_not_onboarded(client):
    c, _ = client
    body = c.get("/api/profile", headers=bearer(USER)).json()
    assert body["profile"]["onboarded"] is False and body["profile"]["goals"] == []


def test_put_saves_fields_and_complete_marks_onboarded(client):
    c, engine = client
    r = c.put("/api/profile", headers=bearer(USER), json={
        "display_name": "Nishant", "currency": "INR", "monthly_budget": 40000, "use_case": "personal",
        "goals": ["save_more", "cut_subscriptions"], "complete": True})
    p = r.json()["profile"]
    assert r.status_code == 200 and p["onboarded"] is True and p["display_name"] == "Nishant"
    assert c.get("/api/profile", headers=bearer(USER)).json()["profile"]["goals"] == ["save_more", "cut_subscriptions"]


def test_partial_put_keeps_other_fields(client):
    c, _ = client
    c.put("/api/profile", headers=bearer(USER), json={"display_name": "A", "currency": "CHF"})
    p = c.put("/api/profile", headers=bearer(USER), json={"monthly_income": 5000}).json()["profile"]
    assert (p["display_name"], p["currency"], p["monthly_income"], p["onboarded"]) == ("A", "CHF", 5000, False)


@pytest.mark.parametrize("bad", [
    {"display_name": ""}, {"display_name": "x" * 61}, {"currency": "rupees"}, {"monthly_budget": -1},
    {"monthly_income": 1e13}, {"use_case": "company"}, {"goals": ["get_rich"]},
])
def test_put_rejects_invalid_values(client, bad):
    c, _ = client
    assert c.put("/api/profile", headers=bearer(USER), json=bad).status_code == 422


def test_put_creates_row_when_email_taken(client):
    c, engine = client
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email) VALUES (:i, 'me@example.com')"), {"i": OTHER})
    r = c.put("/api/profile", headers=bearer(USER), json={"display_name": "Me"})
    assert r.status_code == 200
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email FROM users WHERE id = :i"), {"i": USER}).scalar() \
            == f"{USER}@users.lumen.local"


def test_demo_accounts_get_the_demo_profile_and_cannot_write(client):
    c, _ = client
    p = c.get("/api/profile", headers=bearer(USER, anonymous=True)).json()["profile"]
    assert p["demo"] is True and p["onboarded"] is True and p["currency"] == "INR"
    assert c.put("/api/profile", headers=bearer(USER, anonymous=True), json={"display_name": "x"}).status_code == 403


def test_load_profile_is_none_until_onboarded(client):
    from sqlalchemy.orm import Session

    from api.profile import load_profile

    c, engine = client
    c.put("/api/profile", headers=bearer(USER), json={"display_name": "A", "currency": "USD"})
    with Session(engine) as s:
        assert load_profile(s, USER) is None
    c.put("/api/profile", headers=bearer(USER), json={"complete": True})
    with Session(engine) as s:
        assert load_profile(s, USER)["currency"] == "USD"
```

- [ ] **Step 2: Run to see them fail**

Run: `cd backend && pytest tests/test_api_profile.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'api.profile'`.

- [ ] **Step 3: Implement**

`backend/models/__init__.py`, add to `class User` (after `email`):

```python
    # SPEC-ONBOARD profile; all nullable (added to existing databases by _ADDED_COLUMNS)
    display_name = db.Column(db.String)
    avatar_key = db.Column(db.String)
    currency = db.Column(db.String(3))
    monthly_income = db.Column(db.Float)
    monthly_budget = db.Column(db.Float)
    use_case = db.Column(db.String)
    goals = db.Column(db.Text)  # JSON list of goal ids
    onboarded_at = db.Column(db.DateTime)
```

`backend/models/database.py`, add to `_ADDED_COLUMNS`:

```python
    "users": [("display_name", "VARCHAR"), ("avatar_key", "VARCHAR"), ("currency", "VARCHAR(3)"),
              ("monthly_income", "FLOAT"), ("monthly_budget", "FLOAT"), ("use_case", "VARCHAR"),
              ("goals", "TEXT"), ("onboarded_at", "TIMESTAMP")],  # SPEC-ONBOARD
```

`backend/api/profile.py`:

```python
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
```

`backend/asgi.py`: add `profile` to `from api import ...` and to `create_app(..., profile.router)`.

- [ ] **Step 4: Run the tests**

Run: `cd backend && pytest tests/test_api_profile.py -q` → all pass. Then `pytest -q` → nothing else broke.

- [ ] **Step 5: Commit** — `git commit -m "Profile columns on users and GET/PUT /api/profile (ONB-01)"`

### Task 2: avatar upload

**Files:**
- Modify: `backend/api/profile.py`
- Test: `backend/tests/test_api_profile.py`

**Interfaces:**
- Produces: `PUT /api/profile/avatar` (multipart field `file`) → `{"success": true, "profile": Profile}` with the new
  `avatar_key`. 413 when > 2 MB, 415 when not PNG/JPEG/WebP, 403 for demo accounts.

- [ ] **Step 1: Failing tests** (append; uses the `_files_in_tmp` autouse fixture from `conftest.py`)

```python
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def upload(c, data, who=USER, anonymous=False, name="me.png"):
    return c.put("/api/profile/avatar", headers=bearer(who, anonymous), files={"file": (name, data)})


def test_avatar_upload_is_stored_under_the_user(client):
    import utils.files

    c, _ = client
    p = upload(c, PNG).json()["profile"]
    assert p["avatar_key"].startswith(f"{USER}/avatar-") and p["avatar_key"].endswith(".png")
    assert utils.files.get_store().get(p["avatar_key"])[0] == PNG


def test_second_upload_replaces_and_deletes_the_first(client, monkeypatch):
    import utils.files
    from api import profile

    c, _ = client
    first = upload(c, PNG).json()["profile"]["avatar_key"]
    monkeypatch.setattr(profile.time, "time", lambda: 9_999_999_999)
    second = upload(c, JPEG, name="me.jpg").json()["profile"]["avatar_key"]
    assert second != first and second.endswith(".jpg")
    assert utils.files.get_store().get(first) is None


def test_avatar_checks_content_not_name(client):
    c, _ = client
    assert upload(c, b"%PDF-1.7 not an image", name="me.png").status_code == 415


def test_avatar_too_big(client):
    c, _ = client
    assert upload(c, PNG + b"\x00" * (2 * 1024 * 1024)).status_code == 413


def test_demo_accounts_cannot_upload(client):
    c, _ = client
    assert upload(c, PNG, anonymous=True).status_code == 403
```

- [ ] **Step 2: Run** `pytest tests/test_api_profile.py -q` → the five new tests fail (404).

- [ ] **Step 3: Implement** (in `api/profile.py`; add `import time` and `from fastapi import File, UploadFile`)

```python
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
```

Check `utils/files._type` maps `.webp` to `image/webp` (add it if missing).

- [ ] **Step 4: Run** `pytest tests/test_api_profile.py -q` and `pytest -q` → all pass.

- [ ] **Step 5: Commit, push, PR "ONB-01"** — update `docs/CODEBASE-GUIDE.md` (profile API) in the same commit.

## ONB-02: onboarding screens and the gate (PR 2)

### Task 3: profile client, ProfileProvider, gate, sidebar and greeting

**Files:**
- Modify: `frontend/src/lib/api/client.ts` (add `profileApi`, `Profile` type)
- Create: `frontend/src/components/profile/profile-provider.tsx`
- Modify: `frontend/src/app/(app)/layout.tsx` (wrap in `ProfileProvider`)
- Modify: `frontend/src/components/app-sidebar.tsx` (name and photo from the profile)
- Modify: `frontend/src/app/(app)/dashboard/dashboardContent.tsx` (greeting)

**Interfaces:**
- Consumes: `GET/PUT /api/profile`, `PUT /api/profile/avatar`, `GET /api/files/{key}` (Task 1-2).
- Produces: `profileApi.get(): Promise<Profile>`, `profileApi.update(p: Partial<ProfileInput> & {complete?: boolean}):
  Promise<Profile>`, `profileApi.uploadAvatar(file: Blob): Promise<Profile>`, `profileApi.avatarUrl(key): Promise<string>`
  (object URL from an authed fetch); `useProfile(): { profile: Profile | null; avatarSrc: string | null; refresh():
  Promise<void> }`.

- [ ] **Step 1:** `client.ts` — add next to the other `*Api` objects:

```ts
export type Goal = "save_more" | "cut_subscriptions" | "stay_on_budget" | "pay_off_debt" | "emergency_fund"
	| "big_purchase" | "business_expenses";
export type Profile = {
	display_name: string | null; avatar_key: string | null; currency: string | null;
	monthly_income: number | null; monthly_budget: number | null;
	use_case: "personal" | "household" | "business" | null; goals: Goal[]; onboarded: boolean; demo: boolean;
};
export type ProfileInput = Omit<Profile, "avatar_key" | "onboarded" | "demo">;

export const profileApi = {
	get: async (): Promise<Profile> => (await apiClient.get("/api/profile")).data.profile,
	update: async (p: Partial<ProfileInput> & { complete?: boolean }): Promise<Profile> =>
		(await apiClient.put("/api/profile", p)).data.profile,
	uploadAvatar: async (file: Blob): Promise<Profile> => {
		const form = new FormData();
		form.append("file", file, "avatar.jpg");
		return (await apiClient.put("/api/profile/avatar", form)).data.profile;
	},
	// The bucket is private: fetch with the token, show as an object URL.
	avatarUrl: async (key: string): Promise<string> =>
		URL.createObjectURL((await apiClient.get(`/api/files/${key}`, { responseType: "blob" })).data),
};
```

- [ ] **Step 2:** `profile-provider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { profileApi, type Profile } from "@/lib/api/client";

type Value = { profile: Profile | null; avatarSrc: string | null; refresh: () => Promise<void> };
const ProfileContext = createContext<Value>({ profile: null, avatarSrc: null, refresh: async () => {} });

/** Loads the profile once for the signed-in app, and sends accounts that haven't onboarded to /onboarding. */
export function ProfileProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();
	const { user } = useAuth();
	const [profile, setProfile] = useState<Profile | null>(null);
	const [avatarSrc, setAvatarSrc] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const p = await profileApi.get();
		setProfile(p);
		const google = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null;
		setAvatarSrc(p.avatar_key ? await profileApi.avatarUrl(p.avatar_key).catch(() => google) : google);
	}, [user]);

	useEffect(() => { refresh().catch(() => {}); }, [refresh]);

	useEffect(() => {
		if (profile && !profile.onboarded && !profile.demo) {
			router.replace(`/onboarding?next=${encodeURIComponent(pathname)}`);
		}
	}, [profile, pathname, router]);

	return <ProfileContext.Provider value={{ profile, avatarSrc, refresh }}>{children}</ProfileContext.Provider>;
}

export const useProfile = () => useContext(ProfileContext);
```

Revoke the previous object URL when `avatarSrc` changes (`useEffect` cleanup with `URL.revokeObjectURL`).

- [ ] **Step 3:** `(app)/layout.tsx`: wrap `<SidebarProvider>…</SidebarProvider>` in `<ProfileProvider>`.
`app-sidebar.tsx`: replace the `user_metadata` effect with `useProfile()` → name = `profile.display_name ??
metadata name ?? email`, avatar = `avatarSrc ?? ui-avatars initials URL`. `dashboardContent.tsx`: pass
`eyebrow={greeting}` where `greeting = profile?.display_name ? \`Good ${partOfDay()}, ${firstName}\` : "Operations"`
(`partOfDay`: morning < 12, afternoon < 17, evening).

- [ ] **Step 4: Check** — `npm run build` passes. Local signed-in checks use the throwaway launcher below (not in
the repo): the frontend `next start` with the fake local session from #55, and the backend started with token
signatures unchecked, so the fake session's token is accepted. A profile with `onboarded:false` must redirect
`/dashboard` → `/onboarding?next=%2Fdashboard`; the sidebar shows the profile name.

Throwaway launcher (scratchpad, never committed; SQLite database in the scratchpad):

```python
# run_local_api.py — local UI testing only: accepts unsigned tokens. Never commit or deploy.
import os, sys
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.abspath("lumen-local.db")
sys.path.insert(0, r"<worktree>/backend")
import jwt, uvicorn, utils.auth
utils.auth.verify_token = lambda t: jwt.decode(t, options={"verify_signature": False})
from asgi import app
uvicorn.run(app, port=5000)
```

### Task 4: `/onboarding` screens

**Files:**
- Create: `frontend/src/app/onboarding/page.tsx` (+ `layout.tsx` with `metadata.title = "Welcome"`)
- Create: `frontend/src/app/onboarding/onboarding-content.tsx`
- Create: `frontend/src/lib/currency.ts` (`guessCurrency(locale)`, `CURRENCIES`)

**Interfaces:**
- Consumes: `profileApi`, `useAuth`, `AuthShell`, `authInput`, `authLabel`, `authPrimary`, `authSecondary`, `rise`,
  `AuthAlert`, `AuthWaiting` (`components/auth/auth-shell.tsx`).
- Produces: `guessCurrency(locale: string): string` and `CURRENCIES: string[]` (used by Task 5).

- [ ] **Step 1:** `currency.ts`:

```ts
// Region → currency for the browser-locale guess; anything unknown falls back to USD (always editable).
const BY_REGION: Record<string, string> = {
	IN: "INR", US: "USD", GB: "GBP", CH: "CHF", JP: "JPY", CA: "CAD", AU: "AUD", SG: "SGD", AE: "AED", CN: "CNY",
	DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", AT: "EUR", BE: "EUR", PT: "EUR", FI: "EUR",
};
export function guessCurrency(locale: string): string {
	return BY_REGION[new Intl.Locale(locale).maximize().region ?? ""] ?? "USD";
}
export const CURRENCIES: string[] = Intl.supportedValuesOf("currency");
```

- [ ] **Step 2:** `onboarding-content.tsx` — three steps in `AuthShell` (headline per step: "Let's get to / know
*you*.", "Your money, / your *way*.", "What matters / *most*?"), step from `?step=1|2|3` (default 1; `router.push`
on Continue/Back). Load `profileApi.get()` on mount to prefill; prefill name/photo from `user_metadata` when empty;
currency from `guessCurrency(navigator.language)` when empty. Step 1: name (`authInput`, required, `name="name"`,
`autoComplete="name"`), photo (file input `accept="image/png,image/jpeg,image/webp"`; shrink to 256 px JPEG with a
canvas, then `profileApi.uploadAvatar`; preview circle). Step 2: currency (`<select>` with explicit
`bg-[#111113] text-white`, `CURRENCIES`), income and budget (`type="text" inputMode="decimal"`, optional, show
"Approximate, private, optional."), use case (three radio cards with a shared label hit target). Step 3: goals as
toggle chips (`aria-pressed`). Continue → `profileApi.update(stepFields)` then next step; Finish →
`profileApi.update({...step3, complete: true})` → `router.replace(next ?? "/dashboard")`. Errors from the API show in
`AuthAlert` next to the form; the button keeps its label with a spinner while saving. Demo accounts
(`user.is_anonymous`) → `router.replace("/dashboard")`; signed out → `/login?next=/onboarding`.
"1 of 3" in mono above the title; Back hidden on step 1.

- [ ] **Step 3:** `npm run build` and `npx next lint` pass.
- [ ] **Step 4: Check (browser, `next start` + the throwaway local API from Task 3):** fresh fake user → `/dashboard` redirects
to `/onboarding?next=%2Fdashboard`; fill step 1, Continue, refresh on step 2 → still step 2 with step-1 data saved;
Back works; Finish → `/dashboard` with greeting and sidebar name/photo; reopening `/dashboard` doesn't redirect.
Phone width (375 px): the sky band and the form fit, no horizontal scroll.
- [ ] **Step 5: Commit, push, PR "ONB-02"** (update `docs/CODEBASE-GUIDE.md` §7e).

## ONB-03: currency everywhere (PR 3)

### Task 5: `formatMoney` and the frontend sweep

**Files:**
- Create: `frontend/src/lib/format.ts`
- Modify (replace hard-coded ₹ / `en-IN` / `INR`): `components/animatedListItemUse.tsx`,
  `components/analytics/analyticsCards.tsx`, `components/analytics/spendingTrendChart.tsx`,
  `components/ai-analytics/categoryPieChart.tsx`, `components/ai-analytics/reminderDetailsCard.tsx`,
  `components/ai-analytics/anomalyDetectionCard.tsx`, `components/ai-analytics/spendingTrendGraph.tsx`,
  `components/section-cards.tsx` (if it formats amounts). The landing page (`app/page.tsx`) stays INR (marketing copy).

**Interfaces:**
- Consumes: `useProfile()` (Task 3).
- Produces: `formatMoney(amount: number, currency?: string | null, opts?: { decimals?: 0 | 2 }): string` and
  `useMoney(): (amount: number, currency?: string | null) => string` (profile currency by default).

- [ ] **Step 1:** `format.ts`:

```ts
import { useCallback } from "react";
import { useProfile } from "@/components/profile/profile-provider";

/** Money in the reader's language; one decimal style per call site (Vercel: never mix 0 and 2 decimals). */
export function formatMoney(amount: number, currency?: string | null, opts: { decimals?: 0 | 2 } = {}): string {
	const d = opts.decimals ?? 0;
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "INR",
			minimumFractionDigits: d, maximumFractionDigits: d }).format(amount);
	} catch {
		return `${currency ?? ""} ${amount.toFixed(d)}`.trim(); // unknown code stored on an old invoice
	}
}

/** The signed-in user's currency unless the amount has its own (a transaction's stored currency). */
export function useMoney() {
	const { profile } = useProfile();
	return useCallback((amount: number, currency?: string | null) =>
		formatMoney(amount, currency || profile?.currency), [profile?.currency]);
}
```

- [ ] **Step 2:** In each listed component, replace the local formatter/`₹` literal with `useMoney()`; pass a row's
`currency` field where the data has one (transactions list). Add `tabular-nums` to the amount elements touched.
- [ ] **Step 3: Check** — `npm run build`; grep `grep -rn "₹\|en-IN\|\"INR\"" frontend/src --include=*.tsx | grep -v
app/page.tsx | grep -v home/` returns nothing; in the browser (throwaway local API from Task 3) a CHF profile shows CHF on the
dashboard, analytics and AI insights; a transaction stored with `USD` shows `$` in the list.
- [ ] **Step 4: Commit, push, PR "ONB-03"**; tick the currency line in `TODO.md`.

## ONB-04: personalised AI (PR 4)

### Task 6: profile in Ask Lumen

**Files:**
- Modify: `backend/agent/prompts.py`, `backend/agent/tools.py` (`ToolContext`, `get_schema` note),
  `backend/agent/graph.py:120`, `backend/routes/chat.py` (`_ask`), `backend/api/agent.py` (`ask`)
- Test: `backend/tests/test_agent_tools.py`

**Interfaces:**
- Consumes: `api.profile.load_profile(session, user_id)` (Task 1).
- Produces: `ToolContext.profile: dict | None = None`; `system_prompt(today, profile=None) -> str`.

- [ ] **Step 1: Failing tests**

```python
def test_system_prompt_without_a_profile_is_unchanged():
    from datetime import date
    from agent.prompts import SYSTEM_PROMPT, _schema, system_prompt

    assert system_prompt(date(2026, 10, 14)) == SYSTEM_PROMPT.format(today="2026-10-14", schema=_schema())


def test_system_prompt_with_a_profile_uses_its_currency_and_context():
    from datetime import date
    from agent.prompts import system_prompt

    text = system_prompt(date(2026, 10, 14), {"display_name": "Asha", "currency": "CHF", "use_case": "household",
                                              "goals": ["stay_on_budget"], "monthly_budget": 4000,
                                              "monthly_income": None})
    assert "Amounts are in CHF." in text and "INR" not in text
    assert "Asha" in text and "household" in text and "stay on budget" in text and "4000" in text
```

- [ ] **Step 2: Run** `pytest tests/test_agent_tools.py -q` → the second test fails.
- [ ] **Step 3: Implement** in `prompts.py`:

```python
_USE = {"personal": "their personal finances", "household": "their household's finances",
        "business": "their business or freelance work"}


def _about(profile: dict) -> str:
    lines = [f"- Name: {profile['display_name']}" if profile.get("display_name") else None,
             f"- Uses Lumen for {_USE[profile['use_case']]}" if profile.get("use_case") else None,
             f"- Goals: {', '.join(g.replace('_', ' ') for g in profile.get('goals') or [])}"
             if profile.get("goals") else None,
             f"- Monthly budget: {profile['monthly_budget']:.0f}" if profile.get("monthly_budget") else None,
             f"- Monthly take-home income (approximate): {profile['monthly_income']:.0f}"
             if profile.get("monthly_income") else None]
    body = "\n".join(l for l in lines if l)
    return f"\n\nAbout the user (use it to frame answers; it is not data to query):\n{body}" if body else ""


def system_prompt(today: date, profile: dict | None = None) -> str:
    text = SYSTEM_PROMPT.format(today=today.isoformat(), schema=_schema())
    if not profile:
        return text  # identical to the recorded evals
    return text.replace("Amounts are in INR.", f"Amounts are in {profile.get('currency') or 'INR'}.") + _about(profile)
```

`tools.py`: add `profile: dict | None = None` to `ToolContext`; in `get_schema` notes use
`f"Amounts are in {(ctx.profile or {}).get('currency') or 'INR'}."`. `graph.py:120`: `system_prompt(ctx.today,
ctx.profile)`. `routes/chat.py _ask` and `api/agent.py ask`: build `profile` with
`with Session(deps.engine) as s: profile = load_profile(s, user_id)` and pass `profile=profile` to `ToolContext`
(demo accounts have no row, so `None`).
- [ ] **Step 4:** `pytest -q` and `pytest -q -m eval` (replay; no network) → all pass, proving the recordings still
match.
- [ ] **Step 5: Commit.**

### Task 7: currency in insights, budget in the risk check, goal-based suggestions

**Files:**
- Create: `backend/utils/money.py`
- Modify: `backend/ai/analytics_orchestrator.py:107,289,316`, `backend/ai/forecasting_agent.py:274-322`,
  `backend/ai/anomaly_detection.py:252`, `backend/ai/pattern_detection.py:261`, `backend/ai/risk_assessment.py:339`
  caller, `backend/routes/chat.py` (`get_suggestions`)
- Test: `backend/tests/test_money.py`, `backend/tests/test_chat_suggestions.py`

**Interfaces:**
- Produces: `utils.money.fmt(amount: float, currency: str | None) -> str` (symbol for INR/USD/EUR/GBP/JPY, else
  `"CHF 1,234"`), `utils.money.user_currency(user_id: str) -> str` (profile currency or `Config.DEFAULT_CURRENCY`),
  `utils.money.user_budget(user_id: str) -> float | None`.

- [ ] **Step 1: Failing tests**

```python
from utils.money import fmt

def test_fmt_uses_symbols_for_common_codes_and_codes_otherwise():
    assert fmt(1234.4, "INR") == "₹1,234" and fmt(5, "USD") == "$5" and fmt(1234, "CHF") == "CHF 1,234"
    assert fmt(10, None) == "₹10"  # Config.DEFAULT_CURRENCY is INR
```

```python
def test_suggestions_follow_goals(authed_client, monkeypatch):
    import routes.chat as chat
    monkeypatch.setattr(chat, "_profile_for", lambda uid: {"goals": ["cut_subscriptions"], "use_case": "personal"})
    s = authed_client.get("/chat/suggestions").get_json()["suggestions"]
    assert any("subscription" in q.lower() for q in s) and len(s) == 4
```

- [ ] **Step 2: Implement** `utils/money.py` (`_SYMBOL = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£",
"JPY": "¥"}`; `fmt` → `f"{sym}{amount:,.0f}"` or `f"{code} {amount:,.0f}"`; `user_currency`/`user_budget` read
`models.User` via `db.session.get`, returning defaults when no row). Replace each `₹{x:.0f}` with
`{fmt(x, currency)}` where `currency = user_currency(user_id)` is computed once at the top of the public method.
Pass `monthly_budget=user_budget(user_id)` where `calculate_budget_deviation_risk` is called (line 339's caller).
`get_suggestions`: `_profile_for(user_id)` (wraps `load_profile`), `GOAL_QUESTIONS = {"save_more": "Where could I
save money this month?", "cut_subscriptions": "Which subscriptions haven't I used lately?", "stay_on_budget": "Will I
stay within budget this month?", "pay_off_debt": "How much did I spend on loan or card payments this year?",
"emergency_fund": "How much do I spend in a typical month?", "big_purchase": "What could I cut to save for a big
purchase?", "business_expenses": "Which vendors did my business spend the most with?"}`; first the user's goals'
questions, then the current fixed list, deduplicated, first 4.
- [ ] **Step 3:** `pytest -q` passes; `grep -rn "₹" backend/ai backend/routes --include=*.py` leaves only log lines
using `fmt`.
- [ ] **Step 4: Commit, push, PR "ONB-04"**; update `docs/CODEBASE-GUIDE.md` and `docs/direction/PROGRESS.md`.
