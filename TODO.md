# Lumen: what's next

Order (owner, 2026-10-14): **1. build what the landing page claims** (bare-bones UI where a feature has no screen
yet) → **2. revamp the inner app's UI/UX** (layout and new components). Each feature gets a short spec in
`docs/direction/specs/` before it's built. Done work lives in git and `docs/direction/PROGRESS.md`; the July
hardening plan (PLAN.md, phases 0-7) is finished or superseded and was removed on 2026-10-14.

## 1. Landing-page claims not built yet
What `/` promises today (`frontend/src/app/page.tsx`) that the app can't do yet:
- [x] **Bank and card statements in, every transaction in one place** (SPEC-STATEMENTS, CSV done; PDF not yet) ("We connect everything", "Watch your
  spending"): import CSV/PDF statements, sorted and searchable.
- [ ] **Budgets, "left to spend"** ("Stay on budget"): a monthly budget per category or overall; onboarding already
  stores `users.monthly_budget`.
- [ ] **Subscriptions** ("Tame your subscriptions"): find recurring charges, flag unused ones, nudge to cancel
  (`ai/pattern_detection.py` has a start). **Owner: start from email** (the Gmail poller already ingests Netflix-style
  receipts); statements are a second source.
- [ ] **Forecast of spending and cash flow** ("See what's coming"): from your own history (`ai/forecasting_agent.py`
  has a start). **Owner: a proper time-series model** (seasonality, trend, intervals), not moving averages.
- [ ] **Ways to save / idle cash** ("Grow your savings", "We find ways to save", the hero's "9 ways to save").
- [ ] **Money health score with an action list** (the insight marquee; `ai/risk_assessment.py` has a start).
- [ ] **Proactive notifications** ("Advice that comes to you": statement dates, renewals, unusual bills, double
  charges).
- [ ] **Agent: remember goals, web search** (files attached in chat: done 2026-10-15) (Ask Lumen section; AGT-05 memory).

## 2. Inner app revamp (after section 1)
- [ ] **New layout and components** in the landing's language: near-black canvas, Newsreader titles and big numbers,
  Funnel Sans, hairline cards; merge Analytics and AI Insights into one Insights page; Overview as a feed of what
  changed; ask Lumen from anywhere (⌘K); bottom tab bar on phones; a Settings page (edit onboarding answers,
  currency, delete your data).
- [ ] **Instant revisits:** cached data (SWR) and skeletons that match the layout instead of spinners.
- [ ] **No layout shift** when cards change state (reserve space or crossfade; owner rule).
- [ ] **Fake insight cards:** `components/ai-analytics/spendingTrendGraph.tsx` shows three hard-coded "insights" with
  made-up figures to every user. Replace with real insights or remove (do this as soon as the page is touched).
- [ ] **Vercel Web Interface Guidelines** in the inner pages: "…" not "...", no `transition-all`, explicit colours on
  native `<select>` (Windows dark mode), `tabular-nums` for amounts.

## 3. Owner: dashboard settings (steps in `docs/DEPLOY.md` §1)
- [ ] **Google sign-in** (step 5): Google OAuth client + Supabase provider.
- [ ] **Gmail inbox ingestion** (step 5, last bullet): enable Gmail API, add yourself as a test user, redirect URI
  `https://lumen.nishantbuilds.me/oauth/gmail`, Render env `GOOGLE_*` + `EMAIL_POLLING=1`. Code is done.
- [ ] **Email delivery** (step 6): custom SMTP (e.g. Resend); without it confirmation and reset emails don't reach
  users.
- [ ] **LLM capacity:** free tiers are shared by every visitor; add credits or a paid text model before promoting.

## 4. Small follow-ups (from the onboarding review, 2026-10-14)
- [ ] Anomaly card ignores a transaction's own currency (`ai/analytics_orchestrator.py` query lacks `t.currency`).
- [ ] `utils/money._user` doesn't roll back the session after a DB error (Postgres aborted transaction).
- [ ] `PUT /api/profile` accepts `complete` without name / use case (only via `/onboarding?step=3`).
- [ ] Avatar: a failed delete of the old file returns 500 after the new one saved.
- [ ] Onboarding: object URLs not revoked; the gate's `next` drops the query string; `Intl.supportedValuesOf` breaks
  Safari < 15.4.
- [ ] Suggested questions ignore `use_case`; no test that another user can't fetch your avatar.

## 5. AI engineering (see `docs/direction/PROGRESS.md` → Deferred)
- [x] Live exchange-rate tool and follow-up suggestions in Ask Lumen (SPEC-CHAT-TOOLS, 2026-10-15).
- [ ] Harder invoice test set; AI judge for written answers; `currency`/`po_number` in the agent schema at the next
  re-recording; citation format in `/api/documents/ask`.
- [ ] **Chatbot limits audit, then web search** (owner, 2026-10-16): list the questions Ask Lumen can't answer today
  (e.g. "is ₹X a fair price for a Pixel 11?", "my take-home pay under India's new tax regime") and decide which
  tools close them; a web search tool is the first candidate (with sources cited like documents). Fold into
  SPEC-AGENT-TOOLS before the eval re-record.
- [ ] Dashboard "Needs Review" counts transactions, not the review queue, so it always shows 0 (fix in the revamp).
- [ ] Demo setup took 66 s on a freshly restarted API (seeding + document indexing); make it fast before outreach.
- [ ] Agent's "today" is UTC (`api/agent.py`, `routes/chat.py`): 00:00-05:30 IST it's yesterday, so "this month" on
  the 1st means last month. Fix with a timezone in the profile (not hard-coded IST).
