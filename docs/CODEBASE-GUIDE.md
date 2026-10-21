# Lumen codebase guide

How the backend is put together: what lives where, how a request flows, and why it's built that way.
Read this before the code. It's kept current with every feature that ships. Architecture-level "why" is in
`docs/direction/SYSTEM-OVERVIEW.md`; measured results are in `docs/direction/STORY.md` and `benchmarks/`.

Last updated: 2026-10-04 (after RAG; the agent section is filled in when SPEC-AGENT ships).

---

## 1. The shape of the system

```
frontend/ (Next.js)  ──JWT──▶  backend/asgi.py (FastAPI, uvicorn, 1 worker)
                                 ├── /api/documents/*  → api/documents.py → rag/   (new, FastAPI-native)
                                 ├── /api/agent/*      → api/agent.py → agent/  (proposals approve/reject)
                                 └── everything else   → Flask app (app.py, routes/*) mounted behind FastAPI
                                                          ├── /extract           invoice upload → vision LLM
                                                          ├── /chat              Ask Lumen (the agent) + history
                                                          ├── /transactions ...  CRUD
                                                          └── /api/analytics/... dashboards, anomalies, forecasts
all LLM calls ───────────────────────────────────────▶ llm/client.py (one client: failover, deadline, record/replay)
data ─────────────────────────────────────────────────▶ one database: SQLite locally, Postgres (+pgvector) deployed
```

**Two kinds of data, two kinds of retrieval:** numbers live in SQL tables (`transactions`, `transaction_items`)
and are queried by model-written SQL behind guardrails; text lives in `document_chunks` and is found by hybrid
search. The agent's job (next) is to pick the right one.

---

## 2. Module map (`backend/`)

### Entry points and config
| File | What it does |
|---|---|
| `asgi.py` | **The server.** `create_app(*routers)` builds FastAPI: CORS (decided once, here), error handlers, the FastAPI routers, then mounts the Flask app last at `/` so every old URL still works. Lifespan runs the startup checks. Run: `uvicorn asgi:app --workers 1`. |
| `app.py` | The Flask app: CORS, Flask-Limiter, the per-request LLM deadline, DB init, blueprint registration, error handlers. `startup_checks()` (env shadowing, LLM registry, key check). `python app.py` = Flask-only dev server. |
| `config.py` | All settings from env / `backend/.env` (`Config.*`): database URI, Supabase, LLM model env overrides, upload limits, CORS. `SHADOWED_ENV_KEYS` warns when a shell variable silently overrides `.env`. |

### API layer
| File | What it does |
|---|---|
| `api/deps.py` | FastAPI dependencies that behave exactly like the Flask side: `current_user` (same JWT check and 401 bodies), `rate_limit(spec)` (same per-user key and storage as Flask-Limiter), `llm_deadline` (100 s budget per request). |
| `api/errors.py` | Maps errors to the app-wide body `{success: false, error, code}`; `LLMError` → 429/502/503. |
| `api/documents.py` | `POST/GET /api/documents`, `DELETE /api/documents/{id}`, `POST /api/documents/search`, `POST /api/documents/ask`. Gets the RAG service via `Depends(get_service)`, which tests override with fakes. |
| `api/demo.py` | `POST /api/demo/start`: for anonymous (demo) accounts only, seeds the caller's own copy of the demo data once (`scripts/seed_demo_data.seed`). `api/agent.py` caps demo accounts at `DEMO_QUESTIONS_PER_DAY` (20) agent questions a day. |
| `api/profile.py` | SPEC-ONBOARD profile: `GET`/`PUT /api/profile` (name, currency, income, budget, use case, goals; `complete` sets `users.onboarded_at`) and `PUT /api/profile/avatar` (PNG/JPEG/WebP by content, ≤ 2 MB, stored at `{user_id}/avatar-{time}.{ext}`, the old one deleted; served by `GET /api/files`). Demo accounts get a fixed demo profile and can't write. `load_profile(session, user_id)` is the profile for personalisation, or None before onboarding. Profile columns live on `users` (`_ADDED_COLUMNS`). |
| `routes/*.py` (Flask) | `ocr.py` `/extract` (invoice upload), `batch.py` (multi-page PDFs), `chat.py` `/chat` (Ask Lumen = the agent since 2026-10-09, + history; demo accounts share the 20/day cap), `database_query.py` (transactions CRUD), `analytics.py` + `utils/analytics_service.py` (spend summaries), `ai_analytics.py` (anomalies, forecasts, insights, risk), `auth.py` (`/api/v1/auth/me`), `email_config.py` (IMAP polling setup), `health.py`. |

### Auth and tenancy (the rule everything follows)
- `utils/auth.py`: verifies the Supabase JWT (JWKS, RS256/ES256, audience, issuer, role). `require_auth` (Flask)
  and `api/deps.current_user` (FastAPI) both set the user id from the token's `sub`.
- **The user id is never taken from the request body or the model.** SQL is scoped by
  `ai/sql_agent._scope_to_user`; document search filters `user_id` inside `rag/store.py` and builds BM25 per user.
- `utils/limiter.py`: per-user rate-limit buckets (`user:<sub>`, or `ip:` before sign-in).

### The LLM layer (`llm/`): one place that talks to models
| File | What it does |
|---|---|
| `client.py` | `complete(messages, role=...)`: walks the model chain for the active tier (`LUMEN_LLM_TIER`, default openrouter). Rate limit / outage / bad model id → next model; bad key → skip that provider; unusable reply → retry. Every call is cut to the request deadline. `collect_calls()` gathers results for latency/cost metrics. |
| `registry.yaml` + `registry.py` | Model chains per tier (`openrouter`, `groq`, `ollama`) and role (`text`, `vision`, `judge`). Startup check: the judge must be a different model family from the text model. |
| `providers.py` | Per-provider details: URL, key variable, how to switch reasoning off, HTTP status → error kind, key check. |
| `deadline.py` | A request-wide time budget (context variable); each call gets `min(timeout, time left - 2 s)` and is abandoned at its slice. |
| `cassette.py` | Record/replay. `LUMEN_LLM_CACHE=record|replay|off`. Key = sha256 of provider, model, messages, tools, settings. Replay misses raise `CassetteMiss`, never a live call. Repeated identical calls in one case get `#1`, `#2` keys. |
| `errors.py` | `LLMError` kinds: auth, credits, rate_limited, config, unavailable, bad_response, deadline. |
| `utils/llm.py` | Old-style facade (`chat_completion`) that every older caller uses; it calls `llm.client`. |

**Why one client:** free models get overloaded, rate-limited and retired without notice (all three happened
during this build). Handling that once, with typed errors, means features don't each invent their own retries.

### Ask Lumen (SQL path)
| File | What it does |
|---|---|
| `ai/sql_agent.py` | Prompt → model writes SQL → `_validate_sql` (sqlglot: one read-only SELECT on allowed tables, user filter present) → `_scope_to_user` (wraps the query so it can only see the user's rows) → read-only execution, capped rows. Unusable SQL → fallback to "recent transactions" (flagged as a fallback). `_today()` is the date in the prompt (evals pin it). |
| `ai/hybrid_query_engine.py` | `/chat`'s engine: SQL agent → second LLM call writes the answer from the rows. |
| `ai/anomaly_detection.py`, `forecasting_agent.py`, `pattern_detection.py`, `risk_assessment.py`, `analytics_orchestrator.py` | Pre-existing analytics (statistics + optional LLM explanations) behind `/api/analytics/*`. The agent will wrap some as tools. |

### Invoice upload path
`routes/ocr.py` → `utils/upload_validation.py` (size/MIME) → `utils/image_processing.py` (PDF first page via
pypdfium2, image → PNG) → `utils/openrouter.py` (one vision call, JSON reply, one retry) → `utils/normalize.py`
(dates, amounts, names) → `utils/save_transaction.py` (dedupe on user+vendor+invoice number, save items).
SPEC-EXTRACT will replace this with schema-validated extraction, rule checks and a review queue.

### Email inbox ingestion (`inbox/`, `utils/email_poller.py`, `routes/email_config.py`)
Connect Gmail (or IMAP) and money emails become transactions. `inbox/gmail.py` is the Gmail API client (read-only
scope; OAuth with a signed, salted `state`; the refresh token is stored encrypted on `EmailConfig.oauth_refresh_token`,
`imap_server='gmail-api'`) and maps messages to the same shape as IMAP. `utils/email_poller.py` (started when
`EMAIL_POLLING=1`) fetches new mail per user, `inbox/filter.py` keeps money emails, `inbox/parse.py` reads them,
and `inbox/save.py` writes a `Transaction` with `source="email"`, deduped by Message-ID and against existing rows from
any source. The sign-in popup returns to `/oauth/gmail` (`app/oauth/gmail/page.tsx`), which hands `code`/`state` to
`components/gmailOAuthButton.tsx` (postMessage, `BroadcastChannel("gmail-oauth")`, sessionStorage fallback), which
posts them to `/email-config/gmail/callback`. `/email-config/status` reports `provider` (`gmail`/`imap`), last poll,
last error and `transactions_added` (count of the user's `source="email"` rows); `components/emailStatusCard.tsx`
shows them with a **Check now** button (`/poll-now`).

### RAG (`rag/`): document search with citations
| File | What it does |
|---|---|
| `chunking.py` | PDF → title + sections (numbered headings; else paragraphs) → chunks. A chunk never crosses a section; long sections become overlapping pieces. Ids: `<doc id>#sNN` or `#sNN-k`. |
| `ingest.py` | Document → chunks → embeddings → store. Embedded text = title + heading + chunk ("contextual chunk header"). Same user + same content = no-op. |
| `embed.py` | `FastEmbedder` (bge-small, local ONNX), `CachedEmbedder` (committed cache for offline evals), `FakeEmbedder` (tests). |
| `store.py` | `documents` + `document_chunks` tables. Dense search: pgvector `<=>` on Postgres, numpy on SQLite, both exact. Every read takes `user_id`. |
| `bm25.py` | Per-user keyword index (`bm25s`), rebuilt when the user's chunk set changes; keeps codes like `PO-U1-202507-01` whole. |
| `retrieve.py` | `search_documents(mode=dense|hybrid|hybrid_rerank)`: dense top 50 + BM25 top 50 → RRF (k = 60) → cross-encoder over the top 15. |
| `rerank.py` | `FlashReranker` (MiniLM-L-12 cross-encoder, CPU), cached and fake versions. |
| `answer.py` | Cited answer: refuses with no evidence or when the question names a PO/invoice code that isn't in the evidence; otherwise the model answers from the top 5 passages, must cite `[chunk id]`, or replies NOT_FOUND. Invented citations are dropped. |
| `service.py` | One store/embedder/reranker per process, created on first request (`get_service`). Logs every ask's abstention reason. |

**Why hybrid:** measured on 104 questions, dense alone found the right section in the top 5 for 67, + BM25 for 82,
+ rerank for 100. Dense blurs PO numbers; BM25 fixes the document; the reranker fixes the section.

### Data model (`models/`)
`database.py` (Flask-SQLAlchemy `db`, `init_db` creates tables; on Postgres it enables pgvector first, and if that
fails only document search is disabled), `__init__.py` (`User`, `Transaction`, `TransactionItem`, `FraudAnomaly`,
`AnalyticsInsight`, `SpendingPattern`, `EmailConfig`, `Document`, `DocumentChunk`, `EmbeddingVector` type).

---

## 3. How a request flows

**Ask a document question** (`POST /api/documents/ask`):
1. FastAPI checks the JWT (`current_user`), the rate limit, and starts the 100 s LLM budget.
2. `RagService.ask` → `search_documents(user, question)`: embed the question, dense + BM25 over *this user's*
   chunks, RRF, rerank the top 15, keep 5.
3. `answer_from_hits`: refuse early if there's no evidence or a named PO/invoice code isn't in it; otherwise
   one LLM call with the 5 passages; parse `[chunk id]` citations; drop invented ones.
4. Response: `{answer, abstained, reason, sources[]}`; the UI shows the sources under the answer.

**Ask Lumen** (`POST /chat`, Flask, mounted): JWT → `HybridQueryEngine.query` → SQL agent (LLM call 1, validate,
scope, execute) → answer (LLM call 2) → saved to chat history.

**Upload a document** (`POST /api/documents`): JWT, size and `%PDF` checks → `ingest_pdf` → 422 if the PDF has no
text layer (scans need OCR, not built yet).

---

## 4. The eval harness (`evals/`): how quality is measured

- **Data** (`evals/generator/`, written to `evals/data/` by `python -m evals.generator`): seeded synthetic world
  (2 users, a year of transactions, POs), 50 gold SQL questions, 40 invoices with planted faults, a 20-document
  corpus with 70 planted facts, agent and safety cases. Labels come from construction. ~30% test split.
- **Suites** (`evals/suites/`): each runs the *real* pipeline on the data and returns per-case pass/fail plus
  metrics. `sql.py`, `extraction.py`, `safety.py`, `retrieval.py`, `selftest.py`; `common.py` has the ops
  metrics (recorded latency, tokens, list-price cost from `prices.yaml`).
- **Runner** (`python -m evals.run --tier X --suite Y [--record] [--split test --release N]`): replay by default;
  `--record` is the only live path; compares each case with the last committed release and fails on 2+ regressions;
  hard gates (tenant leaks, followed injections, cassette misses) fail immediately. Ignores local `.env` model
  overrides so results are reproducible.
- **Recordings** (`evals/cassettes/<tier>/<suite>.jsonl`, plus `embeddings/` and `rerank/` caches for the local
  models): what lets CI run every eval offline, for free, with identical results.
- **Reporting**: `evals/report.py` writes the README table; `evals/bench.py` compares candidate models (LLM-02).

---

## 5. Tests and running locally
- `cd backend`, then `python -m pytest -q` (unit + API) and `python -m pytest -q -m eval` (replayed evals). Tests
  can't reach the network (conftest blocks sockets) and use dummy keys. Set `LUMEN_TEST_POSTGRES_URL` to run the
  Postgres checks (CI does, with a Postgres 16 service).
- Dev servers: backend `python -m uvicorn asgi:app --port 5000` from `backend/` (blank the `LLM_*` model variables
  to use the registry chains); frontend `npm run dev` in `frontend/` → http://localhost:3000.

## 6. The agent (`agent/`, `api/agent.py`): how it decides, and how it's kept safe

**Mental model:** the agent is a loop where the model chooses tools and the code runs them. The model never touches
the database, the user id, or the data directly; it only *asks* for tools, and the code decides what that means.

```
POST /api/agent/ask ─▶ api/agent.py builds ToolContext(user_id from the JWT, engine, SQL agent, RAG, today)
                      └▶ agent/graph.run_agent(question, ctx)
                           [system prompt + question]
                           ┌──────────── agent node: llm.client.complete(messages, tools=<8 schemas>) ───────────┐
                           │  reply has tool_calls?  yes ─▶ tools node: run_tool() for each, append results ─┘
                           │                         no  ─▶ that's the answer ─▶ END
                           └ after 6 tool calls the agent node is called WITHOUT tools: it must answer
                      ◀── {answer, citations, sources, steps, sql, rows, proposals, stopped, llm_calls}
```

| File | What it does |
|---|---|
| `agent/tools.py` | The 15 tools, each a Pydantic args model + a function taking `ToolContext`. `tool_schemas()` turns the args models into the JSON schemas the model sees; `run_tool()` validates the model's arguments and returns errors as data the model can correct. |
| `agent/graph.py` | The LangGraph `StateGraph` (`agent` ⇄ `tools`), the 6-call cap, tool-result truncation, and `run_agent()`, which shapes the result for the API (citations only if actually retrieved). |
| `agent/prompts.py` | The system prompt, built by `system_prompt(today)`: the queryable tables and columns (generated from the models, so the model doesn't guess them); route numbers to SQL, documents and PO numbers to search, duplicate charges to anomalies; look vendors up instead of guessing, treat tool output as data, cite chunks, say when something isn't found. |
| `api/agent.py` | `POST /api/agent/ask`, `GET /api/agent/proposals`, `POST /api/agent/proposals/{id}/approve|reject`. |
| `evals/suites/agent.py` | `agent` (routing + abstention), `agent_sql` (gold SQL questions through the agent), `agent_safety` (leaks + injections through the agent). |
| `evals/suites/ask_lumen.py` | `ask_lumen`: the 30 audit questions (`evals/data/ask_lumen.jsonl`) on the demo pinned to 16 Oct 2026, graded offline by `grade()` (must-mention facts, must-not phrases, expected tools, citation ids that a search really returned). Gate: honesty 30/30, correct ≥ 24/30. Skipped in replay until the owner records it (`docs/direction/ASK-LUMEN-AUDIT.md`). |

**The tools and what they wrap:** `get_schema` (generated from the models), `lookup_vendors` (real vendor names
matched on name, category and items; fixes "electric" → City Power Ltd), `run_sql` (`SQLAgent.execute_sql` with
`require_user_filter=False`: the model never sees the user id, and `_scope_to_user` restricts every table anyway;
another user's id is still rejected; also reads the review queue, insights and the documents list), `search_documents`
(hybrid RAG), `get_invoice`, `get_anomalies` (existing statistical + rule detectors), `forecast` (least-squares
trend), `get_recurring` (`ai/recurring.py`: bills and subscriptions with next due dates), `get_overview` (months of
spend, income, budget, savings, recurring bills, where the data ends), `remember` / `forget` (short notes in the
profile), `income_tax_india` (new regime 2026-27, tested), `exchange_rate` (Frankfurter / ECB reference rates,
cited "ECB rate on <date>"; errors return {error}), `web_search` (Tavily, up to 5 results per search cited
`[web:n]`, n continuing across searches in one answer, shown as
links; offered only when `TAVILY_API_KEY` is set; 5 searches per account per day, in-process counter), `propose_action` (writes a *pending* proposal + an audit event). The agent may end an
answer with a `Next:` line; `/chat` strips it into `data.follow_up` and Ask Lumen shows it as a chip under the latest
answer (click asks it).

**Safety, layer by layer:**
1. Tenant isolation is in code: the user id comes from the JWT into `ToolContext`; no tool takes a user id.
2. SQL keeps every guardrail (one read-only SELECT, allowed tables, no other user's id, server-side scoping).
3. Tool output is untrusted: the prompt says so, results are truncated, and citations are checked against what
   was actually retrieved.
4. Autonomy boundary: the agent can only *propose*. Approval is a separate authenticated call; every proposal and
   decision is in `audit_events`. Only `update_category` changes data today.

**Context management:** the conversation is system prompt + question + tool exchanges. Each tool result is capped
(3,000 characters; 50 SQL rows; 600 characters per passage) and there are at most 6 tool calls, so one run's
context is bounded. That matters on Groq's free tier (8K tokens/minute).

**Worked example: "What is my average electricity bill?"** (owner's test, 2026-10-04: 5 LLM calls, 3.2 s total,
from the server log):

| # | Prompt tokens | The model asked for | What happened |
|---|---|---|---|
| 1 | 867 | `lookup_vendors(hint="electricity")` | finds **City Power Ltd** via its "Electricity bill" line items |
| 2 | 939 | `run_sql` over a `vendors` table | rejected: "Table 'vendors' is not allowed"; the reason goes back to the model |
| 3 | 1,091 | `get_schema` | learns the real tables and columns |
| 4 | 1,338 | `run_sql(... vendor_name = 'City Power Ltd')` | the average, scoped to the user server-side |
| 5 | 1,442 | no tools: the answer | done |

Calls 2-3 are the cost of guessing the schema. Since 2026-10-06 the system prompt lists the real columns, and on the
`agent` suite the same kind of question now goes lookup → SQL → answer (e.g. "What did I spend on restaurants in May
2026?" went 4 tools → 2); "average fuel bill" is answered straight from `lookup_vendors`, which already has the
totals. Note how the prompt grows with each tool exchange: that's the context the 6-call cap and result truncation
keep bounded.

**How it's measured:** the same datasets as the baseline, replayed from recordings (`evals/cassettes/groq/agent*.jsonl`).
The model writes its own search queries, so their embeddings are cached during `--record` too.

## 7. Local demo data
`python -m scripts.seed_demo_data --user-id <your Supabase user id>` copies the eval world's user u1 (a year of
transactions, line items, 11 documents with the lease) into your local account, touching only the seeded rows. The same `seed()`
backs the live **Try the demo** links: the landing page sends them to `/demo` (`app/demo/page.tsx`), which signs the
visitor in anonymously (Supabase), calls `POST /api/demo/start`, then opens the chat, so every visitor gets a private copy.
The demo is one person's last 12 months ending yesterday: rent (Greenview Residency), phone (SkyTel Mobile, with a price
rise), gym (FitZone Gym), food delivery (QuickBite, with a duplicate charge), a high latest electricity bill, a rental
agreement PDF, and a profile (income 1,20,000, budget 70,000, goals) written to the users row so Ask Lumen sees it. Setup
embeds the demo documents once per server and uploads the files in the background; timings are logged.

## 7b. Deployment (SPEC-DEPLOY, owner runbook in `docs/DEPLOY.md`)
- `lumen.nishantbuilds.me` → Vercel (`frontend/`, production branch `main`); `api.lumen.nishantbuilds.me` → Render
  (`render.yaml`: one free web service, deploys a push to `main` only after CI passes); Supabase for auth + Postgres.
- Retrieval models (bge-small embedder, FlashRank reranker) are cached in `backend/.models` (`rag/embed.py`
  `MODEL_CACHE`, git-ignored). The build runs `python -m scripts.fetch_models` to download them, and in production
  `asgi.py` loads them in a background thread at startup, so the first question doesn't pay for either.
- `.github/workflows/ci.yml`: backend tests on Postgres 16 + pgvector, offline eval replay, frontend lint.
  `keep-warm.yml` pings `/health` every 10 minutes so the free API doesn't sleep.
- `frontend/src/components/server-wake.tsx`: if the API hasn't answered in 3 s, a small pill says it's waking up (not on
  the landing or sign-in pages, which don't need the API; they still ping it so it's warm by the time the app opens).

## 7b2. App frame and navigation (frontend)
- The signed-in pages live in the route group `app/(app)/`: `/home`, `/spending`, `/bills`, `/receipts`
  (`?tab=documents|import|review`), `/ask`, `/settings`. The old URLs (`/dashboard`, `/analytics`, `/ai-analytics`,
  `/chatbot`, `/documents`, `/import`, `/review`, `/upload`) redirect to them in `next.config.js` (temporary 307s, query
  strings carried). Until UI revamp Phase 5, Spending, Bills and Receipts reuse the old pages' `*Content.tsx`.
- **Sidebar** (`components/app-sidebar.tsx`): Home · Track (Spending, Bills & subscriptions) · Receipts & statements
  (badge = flagged review items) · Ask Lumen (Ctrl/⌘+K). It collapses to a 56px icon rail with Ctrl/⌘+B, remembered
  in the `sidebar_state` cookie. The layout reads that cookie on the sidebar's first render, which is always
  client-side because the auth guard shows a loader on the server, so there's no jump and no server read. Shortcuts
  skip key presses in text fields (`isTypingTarget` in `lib/utils.ts`). **Account** (Settings, API keys, Log out) is the
  top-right `components/avatar-menu.tsx`, floating over the page (there is no top bar on desktop; phones keep a slim
  row with the sheet button). The collapse button lives in the sidebar header; on the 56px rail the logo turns into it
  on hover. Every sidebar group is labelled (Overview, Track, Records, Assistant).
  `app/(app)/layout.tsx` holds the auth guard and sidebar; they mount once and stay while you move between
  pages, so only the content area swaps. `app/(app)/template.tsx` fades each page's content in (`.app-page-in` in
  `globals.css`). `components/dashboard-shell.tsx` is just a page's content wrapper and optional header card.
- There is no root `loading.tsx`: the pages are static and prefetched, and a full-screen spinner made every click
  look like a reload.
- **Sky theme (UI revamp, `docs/superpowers/specs/2026-10-20-ui-revamp-design.md`).** `app/(app)/layout.tsx` wraps
  the shell in `<div data-app-theme="sky" className="contents">`. In `globals.css`, `:root:has([data-app-theme="sky"])`
  swaps every shadcn colour token to the light Sky palette, so portaled menus and dialogs match too. The
  `dark:` variant is also switched off while the shell is mounted. Public pages keep the forced dark theme.
  Extra tokens: `good`, `bad`, `accent-soft`, `--band`. Type roles: `font-serif` (Newsreader), `font-label` /
  `.label-ui` (card titles, tags, ticks: Funnel Sans, sentence case; the owner ruled out all-caps mono labels).
- **No layout shift from overlays.** `globals.css` sets `scrollbar-gutter: stable` and cancels Radix's scroll-lock
  margin (`body[data-scroll-locked]`), so opening a menu or dialog never moves the page. Guarded by
  `npm run test:e2e` (Playwright, local only), which drives the dev-only harness `app/dev/layout-shift` (404 in
  production). Firefox is opt-in with `E2E_FIREFOX=1`. `html, body` use `overflow-x: clip`, never `hidden`:
  `hidden` makes `<body>` a scroll container whose scrollbar disappears when a menu opens.
- **Home** (`app/(app)/home/`, UI revamp Phase 2): greeting and a serif brief over a sky band, then the cards.
  The main column has Spent this period (a hand-drawn SVG: cumulative now vs the previous period, a forecast to month-end, bill pins,
  1W/1M/3M/YTD), Lumen found, and Spending calendar + Recent transactions. The side column has Budget, Upcoming bills, the draft-budget promo and
  Activity. `use-home-data.ts` fetches today's endpoints in parallel (transactions, reminders, forecast, review
  queue). A failed call empties only its card. Skeletons show only on the first load, so changing the chart range
  never blanks other cards. All the maths is pure, in `lib/home-math.ts` (unit tests: `e2e/home-math.spec.ts`).
  **Phase 3 backend:** `GET /api/home/summary` (`api/home.py` over the pure `ai/home_signals.py`, no LLM) supplies
  Lumen found and Activity:
  - Lumen found shows double charges (the only items with a "you may get back" ₹), receipts to review, category spikes
    vs the same day last month, and subscription price rises from `ai.recurring`.
  - Activity shows statement imports grouped into one line, receipts read, and your approve/reject decisions.

  Text carries `{0}` placeholders plus `amounts`, which the client fills in the user's currency (`fill` in
  `lib/home-math.ts`). The brief adds "The one thing worth a look" from the top item.

  Budgets: the overall budget is `User.monthly_budget` (onboarding); per-category limits are the `budgets` table.
  - `GET/PUT /api/budget` (`api/budget.py`).
  - `POST /api/budget/draft` runs the deterministic `ai/budget.py` (3-month mean, rounded up) and files `set_budget`
    proposals. Approving one (`/api/agent/proposals/{id}/approve`) upserts the row. A new draft retires pending ones.
  - Ask Lumen's `draft_budget` tool files the same proposals.
  - Home's draft dialog approves lines one by one or all at once.

  The sidebar badge uses `GET /api/review?count=1`. `(app)/layout.tsx` is a
  tiny server file exporting the light `theme-color`; the client shell is `components/app-shell.tsx`.
- **Signed-in e2e:** `e2e/fixtures.ts` `signIn(page)` fakes a Supabase session (localStorage) plus the
  `lumen_session` cookie, and stubs every backend call, so `e2e/shell.spec.ts` drives the real shell without servers.
- **Motion:** use `motion/react` only (framer-motion was removed). Shared timings live in `lib/motion.ts`
  (`DURATION`, `EASE_OUT`, `fadeUp`). Reduced motion is honoured globally by `MotionConfig reducedMotion="user"`
  in the app layout and a CSS rule in `globals.css`.

## 7c. Ask Lumen screen (frontend, UI phase)
- `/ask` (`app/(app)/ask/chatbotContent.tsx`; `/chatbot` redirects) holds **conversations** with the agent (UI revamp
  Phase 4).
  - **Threads.** Threads live in `chat_threads`; `chat_messages.thread_id` was added through `_ADDED_COLUMNS`. The
    routes in `routes/chat.py` are `GET /chat/threads`, `GET`/`DELETE /chat/threads/<id>`, and `POST /chat` with an
    optional `thread_id` (none starts a thread titled from the question). Another user's id is a 404.
  - **Legacy history.** Messages saved before threads fold into one "Earlier chats" thread the first time you list
    threads. `GET/DELETE /chat/history` are gone.
  - **Memory.** The agent gets the thread's last 6 messages (user/assistant only, 1,500 chars each) between the system
    prompt and the question (`run_agent(history=...)`). With no history the prompt is unchanged, which keeps the evals
    comparable.
  - **The page.** Opening Ask starts a fresh chat with suggestions (from Home's "Lumen found" via
    `suggestedQuestions`, then `/chat/suggestions`). Past chats sit in `thread-rail.tsx` (a column on desktop, a Sheet
    on small screens). `/ask?q=…` starts a new chat with that question once, then cleans the URL.
  - **Answers.** `POST /chat` returns the markdown answer plus its evidence: `sources` (passage `text` and the original's
    `file_key`), `steps` (tool, summary, `latency_ms`) and `proposals`. The SQL the agent ran stays server-side. Saved
    messages keep only the text, so older answers show citation numbers without passages.
  - **Next: line.** The agent's last "Next: …" line becomes the follow-up chip (`split_follow_up` also accepts
    "Next :", the full-width colon and dashes), and `answer.tsx` never renders a bare trailing "Next:".
- **Ask anything** (`components/ask-palette.tsx`): the sidebar button, or ⌘/Ctrl+K anywhere outside a text field
  (`e.code === "KeyK"`, so Caps Lock and Shift work), opens a one-line dialog; Enter goes to `/ask?q=…`.
- `components/ask/`: `prompt-bar.tsx` (composer; the mic button is a placeholder until voice has a backend),
  `work-trace.tsx` ("Thinking" timer, then the collapsible list of steps in plain words, no queries or raw errors),
  `invoice-card.tsx` (paperclip in the prompt bar sends the file as multipart `file` with the question; the answer
  returns `attachment` and the card shows the read invoice, its checks and **Save to my records**, which approves the
  `save_invoice` proposal through `agentApi.decide`; "Saved for review" if the checks flagged it, 409 = already saved),
  `answer.tsx` (markdown via `react-markdown` + `remark-gfm`; `[<doc id>#sNN]` citations, also padded or in
  full-width brackets, become numbered chips that open the passage card with **Open original**; a note when the
  answer cites nothing and touched no data), `proposal-card.tsx` (approve/reject a proposed change), `button.tsx`.
- Look: components adapted from Beautiful UI (beautifului.dev, MIT). Its tokens live in `app/beautiful-ui.css`,
  scoped to a `.bui` wrapper. Inside the signed-in app, `:root:has([data-app-theme="sky"]) .bui` remaps every token to
  Sky (light paper, blue accent, AA text), so Ask is light with no component changes. Inside `.bui`, use its own
  tokens (`bg-hover`, `bg-surface`, `border-line`, `text-ink-2`), not shadcn's `accent`, which resolves to bui's blue
  `--accent` there. Empty chat = greeting + large composer + suggestion pills; then the composer docks below.

## 7d. Landing page (frontend, UI phase)
- `/` (`app/page.tsx`) follows the owner's reference site (useorigin.com) in structure, type and motion, with
  Lumen's own copy, positioned as the AI money advisor Lumen is growing into (unbuilt parts: PROGRESS, Deferred,
  "Product vision"). Sections: glass nav; sky-video hero with a phone of cycling glass cards; a promise panel with a
  horizon glow; an auto-scrolling feature carousel (`components/home/feature-carousel.tsx`); a stack of cycling
  notifications over a dotted grid; three photo + screen pairs; "Nothing changes without you" with a working
  approve/reject card (`proposal-demo.tsx`); the Ask Lumen phone that plays a scripted conversation (`chat-demo.tsx`);
  example questions; a closing call to action over a photo.
- Showcase screens (`mocks.tsx`) are polished versions of the app with sample data, in Hanken Grotesk (loaded in
  `page.tsx` as `--font-ui`); headlines use the Newsreader serif, labels Roboto Mono. No numeric claims about
  Lumen itself, testimonials or customer logos.
- Media: Pexels photos and a 1080p sky video (first frame trimmed; `sky-poster.jpg` paints first) in `public/home/` (sources listed in `components/home/scenes.tsx`;
  Pexels license, no attribution required). `sky.tsx` starts the muted video; reduced motion shows a still blue.
- Motion (2026-10-14 pass): static by default. The hero still rises in once (CSS); everything else that moves says
  something, in `components/home/motion.tsx`: the hero word rotates (`RotatingWord`), the savings figure rolls
  (`RollingNumber`), the promise paragraph lights up word by word with scroll (`ScrollLitText`, CSS scroll-driven
  animation), its labels decode once (`DecodeText`), photo panels wipe open (`Wipe`) and the closing photo settles with
  scroll. `smooth-scroll.tsx` adds Lenis inertial scrolling to the landing page only. All of it is off for reduced
  motion (`app/home.css`).
- **Get started** / **Log in** go to `/login`; the demo links (**See it in the demo**, **Try the demo**) go to `/demo`.

## 7e. Sign-in pages (frontend, UI phase)
- `/login`, `/reset-password` and `/demo` share `components/auth/auth-shell.tsx`, so leaving the landing page feels like
  one site: the hero's sky (`Sky`) on the left with a serif headline and the landing's cycling notifications, the
  near-black form panel on the right (a sky band above the form on phones). The shell also exports the form styles
  (`authInput`, `authPrimary`, ...), `AuthAlert`, `AuthWaiting` and `rise(step)` (stagger for `.auth-rise` in `home.css`).
- `/login` (`app/login/login-content.tsx`; the old `/signin` redirects here, see `next.config.js`): log in, sign up and reset in one form (Google first, then email and
  password, "Forgot password?" under the password, the switch link at the bottom). Changing mode replays the headline
  and the rows' rise. The auth calls are Supabase's (`signInWithPassword`, `signUp`, `resetPasswordForEmail`,
  `signInWithOAuth`); `AuthProvider` sees the session and the page redirects to `next`. A demo (anonymous) session
  doesn't count as signed in here, so demo visitors can still log in or sign up. A failed email or Google link comes
  back as `#error_description=...`; the page shows it in plain words and drops it from the URL. Google sign-in and
  email delivery are Supabase dashboard settings (`docs/DEPLOY.md` section 1, steps 5 and 6).

## 7f. Onboarding and profile (frontend, SPEC-ONBOARD)
- `/onboarding` (`app/onboarding/onboarding-content.tsx`): three steps in the sign-in pages' shell (you: name and
  photo; money: currency, income, budget, who it's for; goals). The step is in the URL (`?step=2`) and each step saves
  on Continue (`profileApi` in `lib/api/client.ts`), so refresh and Back resume. Photos are centre-cropped to a 256 px
  JPEG in the browser before upload. The currency is guessed from the browser language (`lib/currency.ts`).
- `components/profile/profile-provider.tsx` (inside `app/(app)/layout.tsx`) loads the profile once, exposes
  `useProfile()` (profile + photo URL), and sends real accounts that haven't finished onboarding to `/onboarding`.
  Demo accounts skip it. The sidebar and the dashboard greeting read it.

- Personalisation (ONB-03/04): `lib/format.ts` (`formatMoney`, `useMoney`: profile currency unless a row has its
  own), `backend/utils/money.py` (`fmt`, `user_currency`, `user_budget`, `user_income` for insight text and the risk
  score), `system_prompt(today, profile)` in `agent/prompts.py` (unchanged text without a profile), and goal-based
  `/chat/suggestions` in `routes/chat.py`.

## 8. Extraction checks (`extract/`, SPEC-EXTRACT, being built)
- `extract/read.py` (EXT-01): `read_invoice(image_b64, media_type)`: one vision call (role `vision`) with the exact
  JSON shape in the prompt; the reply is validated by a Pydantic `Invoice` (vendor, number, date, **currency, PO
  number, line items, subtotal**, tax, total, payment method, address, category, **notes**), amounts and dates
  cleaned with `utils/normalize` helpers; an unusable reply gets one retry, then `LLMError(BAD_RESPONSE)`. Text on
  the invoice is data: `notes` keeps it verbatim for the injection check. Used by upload, batch and the email poller
  (the old `utils/openrouter.py` is gone).
- Vision models: the groq tier tries **Gemini 3.1 Flash-Lite** first (`provider: gemini` in `llm/registry.yaml`,
  key `GEMINI_API_KEY`; free tier ~1K requests/day), then OpenRouter's free chain. A registry row may name its own
  provider.
- `extract/validate.py`: `validate(invoice, Context) -> [Flag]`, pure rules, no LLM: `total_mismatch` (line items
  + tax vs total, 1%), `duplicate` (vendor + invoice number already stored), `unknown_vendor` (warn),
  `bad_date` (future or > 2 years), `no_currency` (warn), `unknown_po` (warn) / `po_mismatch` (vendor or amount),
  `possible_injection` (instruction-like text). `confidence(flags)`: high = no flags, medium = warnings only,
  low = any failure. `Context` carries the user's known vendors, stored invoice numbers and purchase orders.
- `evals/suites/validation.py`: the rules on the labelled invoices (recall per fault type, precision per rule,
  false flags on clean invoices).
- `api/review.py`: the review queue. `POST /api/review` checks an extracted invoice: high confidence becomes a
  transaction at once (`review_auto_approved`), otherwise it waits as `flagged`. `GET /api/review?status=`,
  `POST /api/review/{id}/approve` (optional `edits`, re-checked before approval; optional `note`) and `/reject`.
  Only approved invoices become transactions, written in the same database transaction as the status change;
  every step goes to `audit_events` (detail has `review_item_id`). Tables `review_items`, `purchase_orders`
  (the demo seeds its POs).
- **Every way an invoice arrives goes through the checks:** `/extract` (upload), `/extract-batch` (multi-page
  PDF) and the email poller call `api.review.submit_invoice`, the only place an invoice becomes a transaction
  (`utils/save_transaction.py` is gone). Upload responses carry `review: {id, status, confidence, flags}` and
  `transaction_id` only when approved; a re-upload is flagged as a duplicate. Rules skip what today's reader
  can't see: no currency field → no currency warning; an unpriced line item → no totals check; a user with no
  history → no unknown-vendor warning.
- `/review` (frontend, minimal test page): flagged invoices with their reasons; approve (optionally with a
  corrected total) or reject.
- **Feedback loop B** (SPEC-FEEDBACK): `extract.validate.suppressed_warnings(history)` reads the user's review
  history (newest first; `api.review._history`): a warning (`unknown_vendor`, `unknown_po`, `no_currency`)
  approved unchanged `STREAK` (3) times in a row for a vendor becomes a `note` flag (visible, never lowers
  confidence); a rejection or an edited approval ends the streak; failures never adapt. `review_items.extracted`
  keeps what the reader produced, so "edited" = approved invoice differs from it. Measured by
  `evals/suites/feedback.py` (simulated 6-month stream, with vs without; missed faults must stay 0).
- **Original files** (`utils/files.py`, `api/files.py`): every uploaded invoice (upload, PDF batch, email) and document
  keeps its original: `{user}/invoices/{sha256}.{ext}` (content-addressed) and `{user}/docs/{doc id}.pdf`. Local
  folder `backend/instance/files` by default; a private Supabase Storage bucket (`lumen-files`, created on first use)
  when `SUPABASE_SERVICE_ROLE_KEY` is set. `GET /api/files/{key}` serves a file only to its owner (anything else is
  404). Transactions carry `file_key`; documents list `file_key`; a storage failure never loses the upload.
- **Feedback loop A** (SPEC-FEEDBACK): `api.review.corrections_for(engine, user, vendor)` returns the fields a
  reviewer corrected on that user's approved invoices from that vendor (`extracted` vs approved, newest first, max
  3, as `{field, read, correct}`). `read_with_feedback` (used by upload, batch and email) reads once and, only if
  that vendor has corrections, reads again with them as JSON hints in the prompt; the hints are kept on the invoice
  as `feedback_hints`. Not yet measured: the synthetic invoices are read perfectly, so there's nothing to correct.

## Model keys (BYOK, SPEC-BYOK)
- Users add their own OpenAI / Anthropic / Gemini / Groq / OpenRouter key (and a Tavily key for web search) on
  `/settings`. `api/keys.py` validates it against the provider (`check_key`), encrypts it with
  `KEYS_ENCRYPTION_KEY` (`utils/crypto.py`; no `SECRET_KEY` fallback: unset = 503 `keys_unavailable`) into `user_keys`, and only ever returns the last 4. Test and Remove
  are on the same router; the key never appears in a response, log line or error (`keys.mask`).
- Flow: `require_auth` calls `llm.keys.for_user(user, engine)` (a contextvar) -> `keys.user_chain(role)` builds the
  models that user's keys allow, from the BYOK catalogue in `llm/registry.yaml` (loaded by `llm/registry.py`; the
  `agent` role exists only there) -> `llm.client.complete` tries that chain. A role none of the user's keys covers
  (e.g. vision for a Groq-only user) uses the platform chain. `key_rejected` (400) is only for a failing user key;
  then there is no silent fallback to the platform's models.
- No key at all: the platform's chain, capped by the free allowance (`PLATFORM_QUESTIONS_PER_DAY` questions a day,
  `PLATFORM_INVOICE_READS` invoice reads in total). `/chat`, `/api/agent/ask` and `/api/documents/ask` share the
  question allowance. Past it: `needs_key` (402). The chat and the inbox status card link to Settings; the documents
  question box appends a Settings hint (not a link).
- Email poller (no request, so no contextvar): it enters `for_user` for each config's owner. A rejected key stops
  that user's poll; a used-up allowance skips only the invoice email that needed it (retried next poll). Either is
  written to `last_error`, which the inbox card shows.
- `LUMEN_OPENAI_BASE_URL` / `LUMEN_ANTHROPIC_BASE_URL` move those providers to a test server (used by the tests).

## Statement import (SPEC-STATEMENTS)
- `backend/statements/read.py`: decodes the CSV, finds the header row, guesses the column mapping (date,
  description, debit, credit, amount, Dr/Cr marker), parses lines with signs. `vendor.py` cleans bank descriptions
  into a vendor name and a category.
- `api/statements.py`: `POST /api/statements/preview` (columns, guessed mapping, 5 sample lines, counts; a file with
  no header is a 400 with `code: "no_header"` and the first raw rows) and `POST /api/statements/import` (file +
  mapping JSON + currency + header_line). Only debits become transactions (`source="statement"`).
- Dedupe: each line has an `import_key` (sha1 of user, date, amount, description), so re-importing is safe. Invoice
  matching: a debit with the same amount within 3 days and a shared word in the vendor name is "already recorded",
  not added. Credits are counted and skipped; unreadable lines are returned by line number.
- `/import` (frontend, minimal): choose a CSV, adjust the mapping and currency, preview, import, see the result line.
