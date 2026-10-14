# SPEC-ONBOARD: a 30-second onboarding that makes Lumen about you

Status: **DRAFT for owner review**. Owner decisions so far (2026-10-14): onboarding runs once after a new account
is created; the question set below is approved (with one change flagged in "Questions").

## Goal
A new user answers three short steps once, and from then on Lumen uses their name and photo, shows money in their
currency, and frames insights and Ask Lumen's answers around their budget, situation and goals. Demo visitors never
see onboarding.

## Questions (3 steps)
| Step | Field | Required | Used for |
|---|---|---|---|
| 1 You | Name (prefilled from Google) | yes | sidebar, dashboard greeting, Ask Lumen addresses them |
| 1 You | Photo (prefilled from Google; upload or initials) | no | sidebar avatar |
| 2 Money | Main currency (guessed from the browser locale) | yes | every amount on screen and in AI prompts |
| 2 Money | Monthly take-home income, approximate | no | savings rate, "can I afford X?" |
| 2 Money | Monthly spending budget | no | budget-risk check, "will I stay within budget?" |
| 2 Money | Who it's for: just me / my household / my business or freelance work | yes | framing of insights, suggested questions |
| 3 Goals | Any of: save more each month, cut unused subscriptions, stay on budget, pay off debt, build an emergency fund, plan a big purchase, keep business expenses in order | no | which insights lead, Ask Lumen context, suggested questions |

**Change from the approved list:** income is an optional approximate number, not ranges. Ranges would need a
different set of brackets for every currency, and a number lets the app compute savings rate and affordability.
Labelled "approximate, private, optional".

## Data
New nullable columns on the existing `users` table, added at startup through `_ADDED_COLUMNS`
(`backend/models/database.py`), the existing convention (no new migration tool):

| Column | Type | Notes |
|---|---|---|
| `display_name` | `VARCHAR` | 1-60 characters |
| `avatar_key` | `VARCHAR` | storage key `{user_id}/avatar`, only for uploaded photos |
| `currency` | `VARCHAR(3)` | ISO 4217 code |
| `monthly_income` | `FLOAT` | ≥ 0 or null |
| `monthly_budget` | `FLOAT` | ≥ 0 or null |
| `use_case` | `VARCHAR` | `personal` \| `household` \| `business` |
| `goals` | `TEXT` | JSON list of goal ids |
| `onboarded_at` | `TIMESTAMP` | null until step 3 is finished |

The same fields go on the `User` model. Today a `users` row only appears when the first invoice is approved
(`api/review.py` `_record`); the profile API creates it instead, with the same email fallback when the address is
already taken.

## API (FastAPI, `backend/api/profile.py`)
- `GET /api/profile` → the profile plus `onboarded: bool`. No row yet → defaults with `onboarded: false`.
  Anonymous (demo) accounts get a fixed demo profile (`INR`, "Demo visitor", `onboarded: true`), not stored.
- `PUT /api/profile` → partial update, validated with Pydantic (name length, `^[A-Z]{3}$` currency, amounts
  0-10¹², `use_case` and `goals` from the fixed lists). `complete: true` sets `onboarded_at`. 403 for demo accounts.
- `PUT /api/profile/avatar` (multipart) → PNG/JPEG/WebP, ≤ 2 MB, checked by content not extension; stored with
  `utils/files.get_store()` at `{user_id}/avatar` (overwritten on change) and saved as `avatar_key`. The browser
  shrinks the photo to 256 px before upload. It's served by the existing owner-only `GET /api/files/{key}`, so no
  new download endpoint.
- Rate limits follow `api/deps.rate_limit` (avatar: 10 per minute).

## Screens and flow
- `/onboarding` uses the sign-in pages' split layout (`components/auth/auth-shell.tsx`): the sky on the left with a
  headline per step and "1 of 3" in mono; the form on the right with **Back** and **Continue** (step 3: **Finish**).
  Optional fields say so; there's no separate "skip" button.
- The step lives in the URL (`?step=2`) and each step saves on Continue, so refresh, Back and a closed tab resume
  where the user left off.
- Gate: a `ProfileProvider` in `app/(app)/layout.tsx` loads the profile once. A real account with
  `onboarded: false` is sent to `/onboarding`; demo accounts and onboarded users go through. Finishing goes to
  `next` (default `/dashboard`). `/onboarding` sends signed-out visitors to `/login`; an onboarded user can open it
  again to edit their answers (no settings page in this spec).
- Name and photo prefill from Google's `user_metadata` (`full_name`, `avatar_url`) when present. Currency is
  guessed from `navigator.language` (e.g. `en-IN` → INR, `de-CH` → CHF) and is always editable.

## Personalisation
1. **Name and photo:** sidebar (`components/app-sidebar.tsx`) reads the profile; the dashboard header greets by
   first name. Photo order: uploaded, then Google's, then initials.
2. **Currency:** one helper `formatMoney(amount, currency?)` in `frontend/src/lib/format.ts` (`Intl.NumberFormat`,
   the browser's language, the profile currency by default). It replaces the hard-coded ₹/`en-IN` in about ten
   components. A transaction with its own stored currency shows that currency.
   ponytail: no exchange-rate conversion; totals assume amounts are in the profile currency, as today's code
   assumes INR. Add conversion when users mix currencies in practice.
3. **Ask Lumen:** `ToolContext` (`agent/tools.py`) gets a `profile`; `system_prompt(today, profile)`
   (`agent/prompts.py`) says "Amounts are in {currency}" instead of INR and adds a short block: name, who it's for,
   goals, and income and budget when given. Both callers pass it (`routes/chat.py`, `api/agent.py`).
4. **AI insights:** the ₹ in the analytics prompts and fallback text (`ai/analytics_orchestrator.py`,
   `ai/forecasting_agent.py`, `ai/anomaly_detection.py`, `ai/pattern_detection.py`) becomes the profile currency
   (`Config.DEFAULT_CURRENCY` when there's no profile). The budget feeds
   `calculate_budget_deviation_risk(monthly_budget=...)` (`ai/risk_assessment.py`), which today falls back to a
   3-month average.
5. **Suggested questions** (`routes/chat.py`, now a fixed list) are picked from the user's goals and use case.

## Build order (one PR each, into `refactor`)
1. **ONB-01** columns, model, `api/profile.py`, tests.
2. **ONB-02** `/onboarding` screens, the gate, sidebar name and photo, dashboard greeting.
3. **ONB-03** `formatMoney` and the currency sweep in the frontend.
4. **ONB-04** profile in the agent and insight prompts, budget in the risk check, goal-based suggestions; re-record
   the agent eval cassettes.

## Testing
- Backend (pytest, SQLite here and Postgres in CI): columns appear on an existing `users` table; GET without a row;
  PUT validation errors; `complete` sets `onboarded_at`; the taken-email fallback; demo accounts get the demo
  profile and 403 on PUT; avatar wrong type, too big and success; another user can't read your avatar (existing
  `/api/files` rule).
- Agent: `system_prompt` with and without a profile (unit); the eval suites replayed after re-recording.
- Frontend: `next build`; in the browser with a local backend, a new account goes login → onboarding (3 steps,
  refresh mid-way resumes) → dashboard, sidebar shows name and photo, amounts in the chosen currency; demo skips it.

## What only the owner does
- Approve this spec. Re-recording the eval cassettes in ONB-04 uses some Groq quota (one pass of the suites).
- Try the flow once on the live site after release with a fresh account (needs the email setup in DEPLOY.md step 6,
  or Google sign-in from step 5).

## Out of scope
Settings page, deleting your account and data, exchange rates, more than one currency per user, notifications
based on goals.
