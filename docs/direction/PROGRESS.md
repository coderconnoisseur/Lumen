# Build progress

Resume from this file plus `IDEA.md` and `specs/`. Branch: `feat/ai-eng-direction` (not pushed).
Tests: `cd backend && env -u OPENROUTER_API_KEY python -m pytest -q` and `... python -m pytest -q -m eval` (CI runs both).

## Status

| Step | Module | State | Commits |
|---|---|---|---|
| 1 | Network block + dummy keys (6b #1) | ✅ done | 278e229 |
| 2 | LLM-01 provider abstraction, deadline, cassette | ✅ done | 87c5b45 … 2480fda |
| 3 | EVAL-01 harness skeleton | ✅ done | 379e94a, 71b9dae |
| 4 | API-01 FastAPI step 1 + uvicorn | ✅ done | 7e5908b, 32d8f6a, e66a81e |
| 5a | EVAL-02 generator + datasets | ✅ done | f0a9a32 … 9c6479d |
| 5b | EVAL-03 baseline, then LLM-02 bench | ⏳ next | |
| — | SPEC-RAG (full review), then SPEC-AGENT / EXTRACT / UX one-pagers | ⬜ | |

Last commit: `9c6479d` Commit the rendered eval invoices and corpus PDFs.
Suite: 409 passed, 1 skipped (the Postgres dialect check; it runs when `LUMEN_TEST_POSTGRES_URL` is set, and in
CI), 1 deselected; `pytest -m eval`: 1 passed.

## What LLM-01 delivered
- `backend/llm/`:
  - `errors.py`: LLMError plus a new fatal kind, `DEADLINE`.
  - `deadline.py`: request budget, a per-call slice, a hard cap via a worker thread, and a Flask hook (100 s per
    request).
  - `cassette.py`: `off|replay|record`, JSONL per tier/suite, and `CassetteMiss`.
  - `providers.py`: OpenRouter, Groq and Ollama adapters (reasoning switch, status map, key check).
  - `registry.py` + `registry.yaml`: chains per tier and role, env overrides for openrouter, the judge-family
    rule, and an `openrouter/free` warning.
  - `client.py`: `complete()` with client-side failover, retries, Retry-After, telemetry and cassette.
- `utils/llm.py` is now a facade. Every caller is unchanged. `chat_completion` gained `role=` (OCR uses
  `role="vision"`).
- `app.py` runs the registry check at startup and installs the per-request deadline.
- `PyYAML>=6,<7` added to `requirements.txt` (needed for `llm/registry.yaml`).

## What EVAL-01 delivered
- `backend/evals/metrics.py`: pure functions, each with a hand-computed unit test.
  - SQL: result-set compare (multiset, 2 dp, aliases ignored); a fallback counts as a failure; fallback rate.
  - Extraction: field-level P/R/F1 with normalisation.
  - Retrieval: recall@k, MRR, nDCG@10.
  - Agent: tool-selection and abstention accuracy.
  - Reporting: nearest-rank percentiles, Cohen's kappa, Wilson 95% CIs, paired regression changes and gate.
- `backend/evals/run.py`:
  - dev split by default; `--split test` is refused without `--release N`;
  - replay mode by default; `--record` re-records a suite from scratch, `--record --only-missing` keeps
    existing lines;
  - deterministic results JSON;
  - gate against the latest committed `release-*-<tier>-<split>.json` (`min_regressed` in `evals/gates.yaml`,
    default 2); hard-gate failures fail the run;
  - regressed and fixed case ids are always printed.
- `evals/suites/selftest.py`: a model-free suite, so `pytest -m eval` exercises the harness end to end.
- Wiring: `pytest.ini` excludes `eval` by default; CI runs `pytest -q -m eval`; `.gitignore` ignores local
  `evals/results/dev-*.json`.
- Deferred to EVAL-02/03 (they need datasets): `evals/report.py` (README tables between markers), the judge-
  agreement check, the gold-SQL dialect check on SQLite + Postgres, and the real suites.

## What API-01 delivered (step 1 only; porting blueprints is the cut line)
- `backend/asgi.py`: `create_app(*routers)` builds the FastAPI outer app; `app = create_app()` is what uvicorn
  serves. The Flask app is mounted last at `/` through `a2wsgi.WSGIMiddleware`, so every current URL resolves
  as before. No production FastAPI routes yet; the parity tests use a test router.
- `backend/api/deps.py`: `current_user` (same `utils.auth.verify_token`, same 401/500 bodies), `rate_limit(spec)`
  (same per-user key, 60/min default, Flask-Limiter's own storage and `enabled` switch, same X-RateLimit-* and
  Retry-After headers, same 429 body), `llm_deadline` (100 s budget on every FastAPI route).
- `backend/api/errors.py`: the `{success:false, error, code}` body for HTTP errors, unexpected errors and
  `LLMError` (429/502/503, via the shared `utils.errors.llm_error_status`).
- CORS is decided once, by FastAPI's CORSMiddleware with `ALLOWED_ORIGINS`; Flask-CORS's headers are dropped
  from mounted Flask responses.
- `app.startup_checks()` (shadowed env keys, registry judge-family check, key check) now runs in the uvicorn
  lifespan too. Before this it only ran under `python app.py`, so production never ran it.
- `render.yaml`, `DEPLOYMENT.md`, `SETUP.md`: `uvicorn asgi:app --host 0.0.0.0 --port $PORT --workers 1`.
- Dependencies: `fastapi`, `uvicorn[standard]`, `a2wsgi`, `httpx` (TestClient) added; `gunicorn` removed. No
  `slowapi`: `api/deps.py` uses `limits` (already installed with Flask-Limiter) directly.
- `tests/test_asgi.py`: 36 tests. A local uvicorn smoke run (throwaway SQLite, dummy key) served `/health`, the
  preflight, the Flask 401 and `/api/docs`.

## What EVAL-02 delivered
- `backend/evals/generator/` (`python -m evals.generator [--seed 42] [--check]`), deterministic from the seed:
  - `world.py`: 2 users with stable UUIDs, 17 vendors, 428 transactions and 720 line items from 2025-07-01
    to **AS_OF 2026-06-30**, monthly bills, per-user vendor mixes, and 12 purchase orders.
  - `db.py`: loads the world into SQLite or Postgres with the app's own tables (idempotent).
  - `sql_questions.py`: the 50 hand-written questions and gold SQL (15 agg, 11 filter, 12 date, 7 join,
    5 unanswerable).
  - `invoices.py`: 40 invoices (per user: 12 clean, 2 total mismatch, 2 duplicate, 2 unknown vendor, 1 bad
    date, 1 injection), rendered to PNG, plus one seeded degraded copy each (skew, blur or JPEG).
  - `corpus.py`: 20 documents (12 POs, 6 contracts, 2 expense policies) with 70 planted facts, rendered to
    text PDFs; the retrieval set (153 rows: each fact plus 1-2 paraphrases) and the generation set (24
    answerable, 6 not in the corpus, 6 about the other user's POs).
  - `cases.py`: 40 agent routing cases (13 `run_sql`, 10 `search_documents`, 4 `get_anomalies`,
    4 `forecast`, 3 `get_invoice`, 6 decline) and 20 safety cases (10 tenant, 10 injection).
  - `splits.py`: seeded ~30% test split, stratified per dataset.
- `backend/evals/data/`: the committed JSONL, 80 invoice images, 20 PDFs and `LABELLING.md` (method, counts,
  limits, spot checks). Tests check the committed JSONL against the generator and the counts against
  `LABELLING.md`.
- Dialect check: every gold query gives identical result sets on SQLite and Postgres (verified locally on
  pgserver Postgres 16) and passes the app's SQL guardrails unchanged. CI now has a Postgres 16 service and
  sets `LUMEN_TEST_POSTGRES_URL`.
- Dependencies: `reportlab` added (corpus PDFs). `Faker` not added: fixed word lists keep the data identical
  across Faker versions.
- `.gitignore` ignores every png/jpg/pdf, so `backend/evals/data/**` is exempted; `backend/evals/.gitattributes`
  keeps JSONL/JSON on LF so the byte comparisons hold on Windows checkouts.

## Decisions made while building (routine; recorded for review)
- **EVAL-02: purchase orders stay in `evals/data/purchase_orders.jsonl`.** There is no DB table yet, because
  SPEC-EXTRACT owns that schema. The loader adds them once it exists.
- **EVAL-02: retrieval labels are section ids (`<doc id>#sNN`).** A retrieved chunk counts as the section it
  came from, so SPEC-RAG's chunker must not let chunks span sections (or must map them back). Raise this in
  the SPEC-RAG review.
- **EVAL-02: invoices are PNG (plus a JPEG copy for the `jpeg` variant), not PDF.** Each invoice gets one
  degraded copy, round-robin, so 80 extraction calls per recording instead of 160. The gold is the seven fields
  the pipeline stores today. `po_number`, currency and line items are in `invoices.jsonl` for EXT-01.
- **EVAL-02: `get_schema` is never the expected first tool** (a lookup step); decline cases have no tools.
- **EVAL-02: tenant `must_not` values never appear in the question** (an echo isn't a leak). Amounts are
  stored without the currency prefix so "₹2,415.79" still matches.
- **For EVAL-03:** `SQLAgent.generate_sql` puts `datetime.now()` in the prompt, so the cassette key changes
  every day. The SQL suite must pin "today" to AS_OF, or replay will miss.
- **API-01 "byte-identical" means status, body bytes and every non-CORS header.** With one allowed origin,
  Flask-CORS sends `Access-Control-Allow-Origin` even on requests with no `Origin`; CORSMiddleware only answers
  requests that carry one. CORS headers are covered by their own parity tests instead.
- **Disallowed-origin preflight returns 400 from CORSMiddleware** (Flask-CORS returned 200 without the allow
  headers). Browsers block both. CORSMiddleware also adds `Access-Control-Max-Age: 600`.
- **FastAPI validation errors** return 422 `{success:false, error:"Invalid request", code:"invalid_request"}`
  (a new code; Flask has no equivalent).
- **A wrong method on a FastAPI path falls through to Flask** (404 body), because the Flask mount matches every
  path. Revisit when real FastAPI routes land.
- **FastAPI rate-limit buckets are per route** (`fastapi:<route path>`), like Flask-Limiter's per-endpoint
  buckets.
- **BAD_RESPONSE is not failed over.** After `retries`, it's raised, per the SPEC-LLM wording. This keeps OCR at
  most 2 calls per unusable reply. Rate limits, outages and CONFIG errors do fail over.
- **Tests that encoded OpenRouter's server-side failover were updated** to SPEC-LLM's client-side failover:
  - `test_chat_completion_sends_fallback_chain` → `…fails_over_along_the_configured_chain`;
  - the vision typed-error test now expects one call per vision-chain model for 429 and 404, and one for 401;
  - the vision retry test checks `model` instead of `models`.
  - Three `test_llm.py` telemetry tests now read the `llm.client` logger instead of `utils.llm`. The line's
    content is unchanged, plus `provider=` and `cached=`.
- **Tests no longer read the developer's `backend/.env` model chains.** `conftest.py` blanks `LLM_*_MODEL(S)`,
  `LUMEN_LLM_TIER` and `LUMEN_LLM_CACHE`; an empty value means "use the registry" or "off".
- **Provisional OpenRouter judge is `google/gemma-4-31b-it:free`.** Not Qwen, because the ollama tier's text
  model is Qwen. LLM-02 replaces it.
- **`openrouter/free` removed** from the `Config` fallback defaults.

## Open decisions for the owner
- `render.yaml` and the local `backend/.env` still set `LLM_TEXT_FALLBACK_MODELS=…,openrouter/free` (and the
  local `.env` sets `LLM_VISION_MODEL=openrouter/free`). The app now logs a startup warning for these. Should
  `render.yaml` drop them? (Deploy config, so it's your call.)
- Groq's reasoning switches (`reasoning_effort` low/none) and Ollama's `think:false` are taken from the provider
  docs and are **unverified**. LLM-02 checks them.

## Next step
EVAL-03: suites for the current pipeline (sql, safety, ops, extraction) that replay from cassettes, then the
**record step, which the owner runs** (live calls on Groq/Ollama, ~80 extraction + ~50 SQL + safety calls per
tier), then `results/release-0-<tier>-<split>.json` and `docs/direction/BASELINE.md`. Then LLM-02.
