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
| `routes/*.py` (Flask) | `ocr.py` `/extract` (invoice upload), `batch.py` (multi-page PDFs), `chat.py` `/chat` (Ask Lumen + history), `database_query.py` (transactions CRUD), `analytics.py` + `utils/analytics_service.py` (spend summaries), `ai_analytics.py` (anomalies, forecasts, insights, risk), `auth.py` (`/api/v1/auth/me`), `email_config.py` (IMAP polling setup), `health.py`. |

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

## 6. Coming next (filled in as it ships)
- **Agent** (SPEC-AGENT): LangGraph loop, typed tools, proposals with human approval, `/api/agent/ask`.
- **Extraction** (SPEC-EXTRACT): schema-validated invoices, rule checks, confidence, review queue.
