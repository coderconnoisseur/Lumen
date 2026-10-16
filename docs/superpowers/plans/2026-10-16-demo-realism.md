# Demo Realism and Honesty Implementation Plan (Ask Lumen audit, phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The one-click demo looks like a real person's last 12 months ending yesterday, Ask Lumen knows the demo person's income, budget and goals, demo setup takes seconds, and the agent stops claiming memory or stating stale general knowledge as fact.

**Architecture:** `scripts/seed_demo_data.seed()` keeps copying the eval world's user u1, but shifts every date so the newest transaction is yesterday, adds a person's recurring life (rent, phone with a price rise, gym, food delivery, a duplicate charge, a high latest electricity bill), a rental-agreement PDF, and writes the demo profile into the visitor's `users` row (so `profile_for` gives the agent income/budget/goals). Demo documents are parsed and embedded once per process (cached) instead of per visitor; file uploads run in a background thread. Three prompt lines add honesty rules.

**Tech Stack:** Python 3.11, SQLAlchemy, FastAPI, reportlab (already a dependency, `evals/generator/corpus.render_pdf`), fastembed.

**Spec:** `docs/direction/ASK-LUMEN-AUDIT.md` (owner-approved fix order, step 1, 2026-10-16) and SPEC-DEPLOY (one-click demo). No new spec: demo data and prompt wording only.

## Global Constraints
- Only demo accounts change: `seed()` is used by `POST /api/demo/start` (anonymous accounts) and the local CLI. The eval world (`evals/generator/world.py`), its JSONL files and eval suites must NOT change (they replay recorded answers).
- Dates: the newest seeded transaction is `today - 1 day`; the shift is a whole number of days applied to every seeded `transactions.date` ('YYYY-MM-DD' TEXT), `transactions.created_at`, and `purchase_orders.issue_date`. `today` comes from one injectable argument (`seed(..., today: date | None = None)`), so tests are deterministic.
- Personal-life rows are generated relative to `today`, ids derived like the existing ones (`uuid5(user_id, ...)`) so re-seeding is idempotent.
- Demo profile written to the visitor's `users` row (display_name, currency INR, monthly_income 120000, monthly_budget 70000, use_case personal, goals save_more / cut_subscriptions / big_purchase, onboarded_at set), from the single `DEMO_PROFILE` dict in `api/profile.py` (update it to the same values: no second copy of the numbers).
- Fictional names only (no real brands): landlord "Greenview Residency", phone "SkyTel Mobile", gym "FitZone Gym", food delivery "QuickBite".
- No secrets in logs. No AI attribution in commits or files.
- Ponytail: shortest correct diff, reuse existing helpers (`render_pdf`, `ingest_sections`, `chunk_sections`, `files.keep`, `_warm_retrieval`).
- Backend tests (from `backend/`): `OPENROUTER_API_KEY=test-key SECRET_KEY=test-secret-key-for-ci-only SUPABASE_URL=https://example.supabase.co python -m pytest -q -p no:cacheprovider` (baseline 747 passed, 7 skipped, 1 deselected).

## Review Focus
1. Re-seeding the same visitor (double click, retry) creates no duplicate transactions or documents — test in Task 1.
2. A visitor seeded on the 1st of a month still has a full "last month" and a non-empty "this month" (the shift lands the newest row on yesterday) — test in Task 1 with `today=date(2026, 11, 1)`.
3. The second visitor in a process does not embed documents again (embedder called once for N seeds) — test in Task 2.
4. A failing file upload (storage down) doesn't fail demo setup — test in Task 2.
5. A user's own uploads and their `users` row values other than the demo profile fields are never touched by re-seeding (existing guarantee) — keep the existing test green.

---

### Task 1: Demo data looks like a person's last 12 months

**Files:**
- Modify: `backend/scripts/seed_demo_data.py` (`seed()`)
- Modify: `backend/api/profile.py` (`DEMO_PROFILE` values)
- Test: `backend/tests/test_seed_demo_data.py` (extend; read it first and reuse its fixtures)

**Interfaces:**
- Produces: `seed(engine, store, embedder, user_id: str, today: date | None = None) -> dict` (same return keys as today, plus `"documents"` counting the rental agreement).

- [ ] **Step 1: Failing tests** (in `test_seed_demo_data.py`, using its existing engine/store/embedder fixtures; pass `today=date(2026, 11, 1)`):
  - newest transaction date == `2026-10-31`; oldest within 13 months; `created_at` shifted by the same days as `date` for one known row.
  - the personal rows exist: 12 monthly "Greenview Residency" rent rows (category "Housing", ₹22,000) on the 1st..5th; "SkyTel Mobile" monthly (category "Utilities") at ₹499 for the older months and ₹649 for the last 3; "FitZone Gym" monthly ₹1,500 (category "Entertainment" or "Healthcare" — pick one, assert it); "QuickBite" 3-6 times a month ₹250-₹700 (category "Restaurant"); exactly one duplicate pair (same vendor, amount, date) in the current month (QuickBite).
  - the latest "City Power Ltd" bill is at least 1.3× the median of the earlier City Power bills.
  - a document titled like "Rental agreement" exists for the user (via `store.list_documents(user_id)`), and its text mentions the end date (start = 10 months before `today`, 11-month term → ends 1 month after `today`), monthly rent ₹22,000, deposit, 30-day notice, 5% yearly increase.
  - the `users` row has the demo profile: `monthly_income == 120000`, `monthly_budget == 70000`, goals include "big_purchase", `onboarded_at` set; and `api.profile.profile_for(engine, user_id)` returns those values.
  - seeding twice with the same `today` leaves the same transaction count and one rental agreement.
- [ ] **Step 2: Run, expect FAIL** (`... pytest -q -p no:cacheprovider tests/test_seed_demo_data.py`).
- [ ] **Step 3: Implement** in `seed()`:
  - `today = today or date.today()`; after building `txns`, `shift = (today - timedelta(days=1)) - max(date.fromisoformat(t["date"]) for t in txns)` (a `timedelta`); apply to each row's `date` (`.isoformat()`), `created_at`, and PO `issue_date`.
  - Personal rows: a small loop over the 12 months ending at `today` building dicts with the same keys as world transactions (`id` via `remap(f"life-{vendor}-{yyyy-mm}-{n}")`, `invoice_number` like `GR-202610`, `tax_amount` 0 or plausible, `payment_method` "UPI"/"Debit Card", `address` reuse u1's city). Use a seeded `random.Random(user_id)` for QuickBite counts/amounts so it's stable per user. Raise the latest City Power row's `total_amount` to 1.45× the median before insert. Append to `rows` (items: none needed for these).
  - Rental agreement: build `{"title": "Rental agreement - Greenview Residency, Flat 304", "sections": [{"heading": ..., "text": ...}, ...]}` (parties, term with start/end dates, rent and due day, deposit, notice period, yearly increase, maintenance) and ingest with `render_pdf` + the same path the corpus PDFs take (so search and "Open original" work), `doc_type="contract"`, filename `rental-agreement-greenview.pdf`.
  - Profile: set the `users` row fields from `DEMO_PROFILE` (goals stored the way `api/profile.py` stores them — read `_as_dict`/the update route to match; `onboarded_at = now`). Update `DEMO_PROFILE` to `display_name "Demo visitor"`, `monthly_income 120000`, `monthly_budget 70000`, `goals ["save_more", "cut_subscriptions", "big_purchase"]`.
- [ ] **Step 4: Run the file's tests, then the full suite** — all pass (fix `test_api_demo.py` expectations if they counted rows/documents, without weakening them).
- [ ] **Step 5: Commit** `"Demo: a person's last 12 months ending yesterday, with rent, phone, gym, food delivery, a rental agreement and a profile Ask Lumen can use"`.

### Task 2: Demo setup in seconds

**Files:**
- Modify: `backend/scripts/seed_demo_data.py` (document step)
- Modify: `backend/asgi.py` (`_warm_retrieval`: also warm the demo documents)
- Test: `backend/tests/test_seed_demo_data.py`

**Interfaces:**
- Consumes: Task 1's `seed()`.
- Produces: `demo_documents(embedder) -> list[tuple[str, str, list, object]]` in `seed_demo_data.py` — per demo PDF: `(filename, doc_type, sections, vectors)` parsed and embedded once per process (`functools.lru_cache` keyed on the embedder's model id is enough; the rental agreement's text depends on `today`, so it stays per-seed and small).

- [ ] **Step 1: Failing tests:** (a) seeding two different users with a counting fake/wrapped embedder calls `embed_passages` for the corpus PDFs only once in total (the rental agreement may embed per seed); (b) with `utils.files.keep` patched to raise, `seed()` still returns and the transactions exist; (c) both users can search their own documents (a `store` query for a known phrase from a contract returns a hit scoped to each user).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement:** read each demo PDF once (`sections_from_pdf`), embed once (`passage_text` as `ingest_sections` does), cache; per user: `chunk_sections(doc_id, sections)` + cached vectors → `store.upsert_document(...)` (same arguments `ingest_sections` passes). Move the `files.keep(...)` uploads into one `threading.Thread(daemon=True)` started after the DB work, wrapped in try/except with a `logger.warning` (no secrets). Add `logger.info` timings for the three phases (rows, documents, uploads queued) so Render logs show where time goes. In `asgi.py::_warm_retrieval`, after the models load, call `demo_documents(service.embedder)` inside the existing try.
- [ ] **Step 4: Tests + full suite pass.** Also time it locally once (two seeds into a temp SQLite, real `FastEmbedder`) and put the numbers in the report.
- [ ] **Step 5: Commit** `"Demo setup: embed the demo documents once per server, upload files in the background, log timings"`.

### Task 3: Honesty rules and docs

**Files:**
- Modify: `backend/agent/prompts.py` (three rule lines)
- Test: `backend/tests/test_agent_tools.py` (prompt assertions, if a prompt test exists there; else the file that tests `system_prompt`)
- Modify: `docs/CODEBASE-GUIDE.md` (demo section), `docs/direction/PROGRESS.md`, `TODO.md` (tick the demo items), `docs/direction/ASK-LUMEN-AUDIT.md` (a "Phase 1 shipped" line; the re-run numbers are added by the controller later)

- [ ] **Step 1: Failing test:** `system_prompt(date(2026,10,16))` contains "can't remember", "may be out of date" and "where the user's data starts and ends" (exact phrases below); the word "currency" is still absent (existing test).
- [ ] **Step 2: Implement** — add under Rules (keep lines ≤ 118 chars, same style):
  - `- You can't remember things between chats yet. If asked to remember something, say so plainly; never say you will.`
  - `- General knowledge such as tax slabs, prices or interest rates may be out of date: say so, give rough ranges, and suggest an official source; never present it as current fact.`
  - `- Never suggest app features that don't exist. If a period has no data, say where the user's data starts and ends.`
- [ ] **Step 3: Full suite passes.** Docs: short factual updates.
- [ ] **Step 4: Commit** `"Ask Lumen: say it can't remember yet, flag stale general knowledge, show where the data ends"`.
