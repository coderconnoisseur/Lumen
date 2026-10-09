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
                                 ├── /api/agent/*      → (SPEC-AGENT, coming)
                                 └── everything else   → Flask app (app.py, routes/*) mounted behind FastAPI
                                                          ├── /extract           invoice upload → vision LLM
                                                          ├── /chat              Ask Lumen (SQL → answer)
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
| `agent/tools.py` | The 8 tools, each a Pydantic args model + a function taking `ToolContext`. `tool_schemas()` turns the args models into the JSON schemas the model sees; `run_tool()` validates the model's arguments and returns errors as data the model can correct. |
| `agent/graph.py` | The LangGraph `StateGraph` (`agent` ⇄ `tools`), the 6-call cap, tool-result truncation, and `run_agent()`, which shapes the result for the API (citations only if actually retrieved). |
| `agent/prompts.py` | The system prompt, built by `system_prompt(today)`: the queryable tables and columns (generated from the models, so the model doesn't guess them); route numbers to SQL, documents and PO numbers to search, duplicate charges to anomalies; look vendors up instead of guessing, treat tool output as data, cite chunks, say when something isn't found. |
| `api/agent.py` | `POST /api/agent/ask`, `GET /api/agent/proposals`, `POST /api/agent/proposals/{id}/approve|reject`. |
| `evals/suites/agent.py` | `agent` (routing + abstention), `agent_sql` (gold SQL questions through the agent), `agent_safety` (leaks + injections through the agent). |

**The tools and what they wrap:** `get_schema` (generated from the models), `lookup_vendors` (real vendor names
matched on name, category and items; fixes "electric" → City Power Ltd), `run_sql` (`SQLAgent.execute_sql` with
`require_user_filter=False`: the model never sees the user id, and `_scope_to_user` restricts every table anyway;
another user's id is still rejected), `search_documents` (hybrid RAG), `get_invoice`, `get_anomalies` (existing
statistical + rule detectors), `forecast` (least-squares trend), `propose_action` (writes a *pending* proposal + an
audit event).

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
transactions, line items, 10 documents) into your local account, touching only the seeded rows. The same `seed()`
backs the live **Try the demo** button: the sign-in page signs the visitor in anonymously (Supabase) and calls
`POST /api/demo/start`, so every visitor gets a private copy.

## 7b. Deployment (SPEC-DEPLOY, owner runbook in `docs/DEPLOY.md`)
- `lumen.nishantbuilds.me` → Vercel (`frontend/`, production branch `main`); `api.lumen.nishantbuilds.me` → Render
  (`render.yaml`: one free web service, deploys a push to `main` only after CI passes); Supabase for auth + Postgres.
- `.github/workflows/ci.yml`: backend tests on Postgres 16 + pgvector, offline eval replay, frontend lint.
  `keep-warm.yml` pings `/health` every 10 minutes so the free API doesn't sleep.
- `frontend/src/components/server-wake.tsx`: if the API hasn't answered in 3 s, a banner says it's waking up.

## 8. Extraction checks (`extract/`, SPEC-EXTRACT, being built)
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
- Coming: structured vision extraction (EXT-01), feedback loop A (corrections as examples).
