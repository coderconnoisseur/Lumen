# Build progress

Resume from this file plus `IDEA.md` and `specs/`. Branch: `feat/ai-eng-direction` (not pushed).
Tests: `cd backend && env -u OPENROUTER_API_KEY python -m pytest -q` and `... python -m pytest -q -m eval` (CI runs both).

## Status

| Step | Module | State | Commits |
|---|---|---|---|
| 1 | Network block + dummy keys (6b #1) | ✅ done | ae7798f |
| 2 | LLM-01 provider abstraction, deadline, cassette | ✅ done | 11e0e52 … 6f12f3c |
| 3 | EVAL-01 harness skeleton | ✅ done | ac908d2, bb1a7a9 |
| 4 | API-01 FastAPI step 1 + uvicorn | ✅ done | 0a421ae, 2122600, 6f9e1d8 |
| 5a | EVAL-02 generator + datasets | ✅ done | d5c9cd6 … 2eb87ab |
| 5b | EVAL-03 baseline, then LLM-02 bench | 🔄 in progress: suites built, recording (free-tier quota) | a9a9f55 … |
| — | SPEC-RAG (full review) | ✅ approved 2026-10-03 | 64fa55f |
| 6 | RAG-01…06 + documents API/page (built while EVAL-03 waits on quota) | 🔄 retrieval, answering, API, page, RAG-08 cases, RAG-09 (Chroma removed) done; generation suite left | 1d38309 … |
| — | SPEC-AGENT / SPEC-EXTRACT / SPEC-UX one-pagers | ✅ approved 2026-10-04 (LangGraph; auto-approve high confidence; UX: ship, don't polish) | |
| 7 | LLM-02 Groq SQL bench | ✅ done | PR #10 |
| 8 | SPEC-AGENT: tools, loop + API, evals, test page | 🔄 PRs #11, #12 open; evals recording | PR #11, #12 |

Last commit: EVAL-03 in progress (see the branch history).
Suite: 422 passed, 1 skipped (the Postgres dialect check; it runs when `LUMEN_TEST_POSTGRES_URL` is set, and in
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

## EVAL-03 so far
- **Tier for the first baseline: openrouter (free).** The owner OK'd the free Nemotron 3 Ultra (2026-10-03),
  and it's what production runs (`render.yaml`). Groq and Ollama columns follow when their keys/models exist.
  Live calls happen only in the explicit `--record` step.
- **Free-tier limit: 50 requests/day** (key status checked, no quota used). The record plan spans days:
  SQL dev (done except 2), safety (~27 dev calls), extraction (56 dev + 24 test vision calls), SQL test (15).
- **Client fixes for faithful replay** (`a9a9f55`, `47188e8`): replay walks the failover chain; unusable
  replies are recorded and replayed as errors; repeated identical calls within a case get their own
  recordings; `collect_calls()` feeds the ops metrics.
- **Suites:** `evals/suites/sql.py` (strict execution accuracy, gated; relaxed accuracy as a diagnostic;
  fallback rate; unanswerable questions reported separately), `extraction.py` (field P/R/F1 per field and
  variant; "Unknown" payment method counts as missing), `safety.py` (tenant leaks and injections followed,
  both hard gates; pasted documents go through Ask Lumen because the app has no document input in chat),
  `common.py` (ops: recorded latency p50/p95, tokens, list-price cost from `evals/prices.yaml`).
- **`evals.run` ignores `.env` model overrides** during a run, so results depend only on `registry.yaml`.
- **Text fallback changed:** `nex-agi/nex-n2.5-pro:free` stopped being free (404), replaced with
  `qwen/qwen3.8-27b:free` in `registry.yaml`, the `Config` default and QUICK_START.
- **First numbers:** `docs/direction/benchmarks/2026-10-03-sql-dev-partial.md` (20/30 strict, 28/30 relaxed).
- **Benchmarks folder:** the owner asked for every stage's numbers to be kept, so dated snapshots go in
  `docs/direction/benchmarks/`, with the STAR narrative in `docs/direction/STORY.md`. Raw dev JSON stays
  local per SPEC-EVAL; release JSON is committed.
- **Not yet wired:** `pytest -m eval` replaying the real suites. It needs release-0 first, and the baseline may
  fail a hard gate (injection), which the owner has to decide how to treat.

- **Resolved 2026-10-03 (owner):** `render.yaml`'s text fallback is now `qwen/qwen3.8-27b:free` (Nex died;
  `openrouter/free` dropped too). SQL scoring decision delegated to the build: the gated SQL metric is
  column-tolerant execution accuracy, strict reported alongside (SPEC-EVAL amended). Reason: the rows feed an
  answer-writer, so extra columns don't make an answer wrong, wrong rows do; the row count and every gold
  column must still match, so returning everything can't pass.

## Open decisions for the owner
- `render.yaml` and the local `backend/.env` still set `LLM_TEXT_FALLBACK_MODELS=…,openrouter/free` (and the
  local `.env` sets `LLM_VISION_MODEL=openrouter/free`). The app now logs a startup warning for these. Should
  `render.yaml` drop them? (Deploy config, so it's your call.)
- Groq's reasoning switches (`reasoning_effort` low/none) and Ollama's `think:false` are taken from the provider
  docs and are **unverified**. LLM-02 checks them.

## Also done while waiting for quota (2026-10-03)
- `evals/report.py`: `python -m evals.report` writes the README table (between `<!-- eval:start/end -->`,
  new "Evaluation" section) and `results/release-*.md` from the latest committed releases. Every cell shows
  counts and CIs; each tier column names its release and the models that answered.
- `docs/direction/SYSTEM-OVERVIEW.md`: the target architecture and the reason behind each part (for the owner).
- `docs/direction/specs/SPEC-RAG.md`: **draft** for the owner's full review (pgvector + numpy store, section-
  aligned chunks, fastembed bge-small, per-user BM25, RRF k=60, FlashRank rerank, cited answers with
  abstention, embedding cassette for offline evals, first real FastAPI routes for documents). Four open
  questions at the end.

## What RAG has delivered so far (SPEC-RAG)
- `backend/rag/`: `chunking.py` (section-aligned chunks; PDF headings parsed, all 20 corpus PDFs split back
  into their generated sections), `store.py` (documents + chunks tables; pgvector on Postgres, numpy on SQLite,
  exact search, identical top-k verified on local Postgres 16; every read filtered by user), `embed.py`
  (bge-small via fastembed, cached and fake embedders), `bm25.py` (per-user index, rebuilt when the chunk set
  changes; codes like PO numbers kept whole), `retrieve.py` (`dense` / `hybrid` RRF / `hybrid_rerank`),
  `rerank.py` (FlashRank MiniLM-L-12, top 15; cached and fake rerankers), `answer.py` (cited answers; layered
  abstention: score cut-off, identifier grounding, NOT_FOUND), `ingest.py`, `service.py`.
- `backend/api/documents.py`: `POST/GET /api/documents`, `DELETE /api/documents/{id}`, `POST .../search`,
  `POST .../ask` (FastAPI, API-01 parity for auth, limits, errors). Smoke-tested with the real models.
- `evals/suites/retrieval.py` + committed embedding/rerank caches: the ablation (dev): hit@5 67 → 82 → 100/104;
  `docs/direction/benchmarks/2026-10-04-retrieval-ablation-dev.md`.
- Pre-LLM abstention on the dev generation set: 26/26 correct decisions (score cut-off alone: 19/26).
- `init_db` creates the pgvector extension first; if a database refuses it, only document search is disabled.
- Dependencies: fastembed, pgvector, bm25s, flashrank, python-multipart. Process RSS with both models ~128 MB.
- **Decisions:** rerank candidates = 15 (dev: same hit@5 as 30, half the latency); MIN_RELEVANCE = 0.5
  (conservative; little dev data); documents get no FK to `users` (the user filter is on every query).
- **Left for RAG:** the Documents page (written, being type-checked), the generation suite (LLM + judge; needs
  quota and the owner's ~20 judge labels), injection planted inside a corpus document (RAG-08), removing Chroma
  and the `ENABLE_CHROMA` switch (RAG-09), and wiring document answers into chat (that's the agent's job).

## 2026-10-04 (morning)
- SQL dev recordings complete: **29/32** column-tolerant, 21/32 strict, 0 fallbacks, p50 2.9 s / p95 8.9 s (all
  Nemotron today).
- Fixed: `--only-missing` re-called the first model for cases already recorded under the fallback (cost ~12
  requests); the client now searches the whole chain for a recording before any live call.
- Fixed: the safety suite inherited `ENABLE_CHROMA=true` from the local `.env` (extra classifier calls, $0.0000008
  of paid embeddings); that recording was discarded, and the suite now runs production's chat configuration.
  Then RAG-09 removed the Chroma path entirely (`rag_system.py`, classifier, backfill script, `chromadb`).
- Startup key check now reports OpenRouter **credit**, not "requests left" (the daily free cap isn't exposed).
- RAG-08: three poisoned uploaded PDFs in `safety.jsonl` (`doc_injection`), run through document search and the
  cited-answer path; local model caches recorded; LLM recording pending.
- Local dev servers: a local, git-ignored launch config runs `uvicorn asgi:app` on :5000 with registry chains and
  the Next.js dev server on :3000. The owner tests at http://localhost:3000/documents.
- Specs drafted for review: `SPEC-AGENT.md`, `SPEC-EXTRACT.md`, `SPEC-UX.md`.

## 2026-10-04 (afternoon)
- **Owner decisions:** SPEC-AGENT approved with LangGraph; SPEC-EXTRACT auto-approves high-confidence invoices;
  SPEC-UX: ship, don't polish; grounded answers show references under the answer (clicking opens the resource);
  UI stays minimal until a final refactor; PR per concrete step; keep `docs/CODEBASE-GUIDE.md` current.
- **PR stack on coderconnoisseur/Lumen:** #2 direction docs → #3 LLM client → #4 eval harness → #5 FastAPI →
  #6 datasets → #7 baseline suites → #8 hybrid RAG → #9 RAG hardening → #10 Groq tier + guide → #11 agent tools →
  #12 agent loop + API → (#13 agent evals, #14 agent test page). Each based on the previous; merge bottom-up.
  History was rewritten before the first push to remove two unwanted mentions (backup branch
  `backup/pre-history-clean`, local only); commit ids in these notes were remapped.
- **Groq:** key works; free tier per model: 30 RPM, 1K RPD, 8K TPM, 200K TPD; models gpt-oss-120b/20b, qwen3.8-27b,
  no vision. Bench (SQL dev): 29/28/28 of 32, tied; registry groq text = gpt-oss-120b → qwen → gpt-oss-20b, judge
  qwen. Local dev server runs `LUMEN_LLM_TIER=groq`.
- **Owner's manual test** found the reranker-score abstention cut-off refusing short questions → removed (STORY 12).
- **Agent:** tools (8, typed, user id from the JWT), LangGraph loop (6-call cap, truncated results), proposals +
  audit log, `/api/agent/*`. The first recording showed SQL rejections because the model can't write the user-id
  filter; the agent's `run_sql` now relies on server-side scoping (STORY 14).
- **Demo data:** `scripts/seed_demo_data.py` seeded the owner's local account (235 transactions, 10 documents).

## Owner feedback from testing (2026-10-04 evening) and known issues
- Agent answers were fine; speed impressive. "Couldn't locate FM-202606-U1N03" was correct: that number was a bad
  hint (it's from the invoice-image dataset, not stored transactions); hint fixed to the seeded FM-202606-U10223.
- "Average electricity bill" took 5 LLM calls (lookup → SQL on a nonexistent `vendors` table, rejected → get_schema →
  SQL → answer). Done 2026-10-06: compact schema in the system prompt (see below).
- **Polish backlog for the UI refactor (owner: later):** the UI shows raw UUIDs; answers need markdown rendering;
  clicking a reference should open the original document (needs the PDF stored, today only text is kept); general
  formatting; slow tab loads; no separation of concerns in the UI.
- **Backend issue seen in logs:** Ask Lumen `/chat` synthesis sent a 7,270-token prompt and hit `finish=length` at 500
  tokens: the old pipeline dumps up to 100 SQL rows into the answer prompt. Fix when `/chat` moves to the agent, or
  cap the rows/raise max_tokens before then.
- **Where every benchmark lives:** `docs/direction/benchmarks/` (dated snapshots), `docs/direction/LLM-BENCH.md`
  (model choice), `docs/direction/STORY.md` (STAR narrative, 21 entries), `backend/evals/results/` (bench JSON;
  release JSON once release-0 exists), and the recordings that reproduce them in `backend/evals/cassettes/`.

## 2026-10-06: agent prompt iteration (PR #15, `feat/agent-prompt-schema`)
- History of #13/#14 rewritten and force-pushed (owner OK) to drop an old wording from three commits; backups
  `backup/agent-evals-pre-scrub`, `backup/agent-test-page-pre-scrub` (local only).
- The system prompt now carries the two tables and their columns (generated from the models, `user_id` left out),
  plus routing lines: PO numbers -> documents, duplicate charges -> anomalies, try the other likely tool first.
- `agent` dev on Groq, before -> after: calls 73 -> 54, tokens/question 2,961 -> 2,233, p95 5.5 s -> 3.3 s, failed
  SQL 8 -> 0, `get_schema` calls 7 -> 0; routing 22/24 -> 21/24, abstention 28/28 -> 26/28 as scored.
  `docs/direction/benchmarks/2026-10-06-agent-prompt-schema-dev.md`, STORY 16.
- **Grader fixed (owner OK):** lookup-vendor answers count as the SQL route; "not found" after the right tool is
  an answer. Re-scored offline: before and v2 both 24/24 routing, 28/28 abstention (v1 21/24, 26/28). STORY 17.
- **Found while checking:** `get_anomalies` returns vendor/date/amount as null and formats amounts with a euro
  sign (the data is INR). Fix with the deploy work.
- **PRs #2-#16 merged into `refactor`** (owner OK). #16 fixed CI: SQLAlchemy 2.1 switches `postgresql://` to
  psycopg 3 (not installed), and the RAG tests need a pgvector image. SPEC-DEPLOY approved (#17).

Design decisions are logged in one place: `docs/direction/DECISIONS.md`.

## Next step
In order (each step: TDD, small commits, a PR stacked on the previous one, a STORY entry + benchmark snapshot):
1. **Deploy (SPEC-DEPLOY):** built (PR `feat/deploy-config`): render.yaml (API only, CI-gated), keep-warm workflow,
   **Try the demo** (anonymous sign-in + `POST /api/demo/start` seeding a private copy; 20 agent questions/visitor/
   day), waking-up banner, owner runbook `docs/DEPLOY.md`. `get_anomalies` now names vendor/date/amount in INR (3 agent cases re-recorded). Left: release `refactor` ->
   `main`; owner runs `docs/DEPLOY.md`; then check the acceptance list on the live site.
2. **AGT-07 done (2026-10-09):** prompt v3 re-recorded: agent SQL 31/32 vs pipeline 29/32 (3 fixed, 1 defensible
   regression), safety 0 leaks / 0 injections, routing 24/24. Gates met: `/chat` now runs the agent (demo cap shared with
   `/api/agent/ask`; the old pipeline stays only as the eval baseline). Found while testing: Supabase's clock ahead
   of ours made fresh tokens "not yet valid"; JWT check now allows 30 s skew, and a failed demo setup signs out.
   `docs/direction/benchmarks/2026-10-09-agt07-final-dev.md`, STORY 21.
3. **Groq baseline suites:** `safety` and `sql` test split on Groq; `extraction` stays on OpenRouter vision (50
   requests/day): record over several days.
4. **Generation suite** (judge = qwen on Groq) + prompt the owner for ~20 judge labels (`evals/data/judge_gold.jsonl`).
5. **release-0** for both splits, `docs/direction/BASELINE.md`, `evals.report` → README tables, `pytest -m eval`
   replaying the committed suites.
6. ~~Switch `/chat` to the agent~~ done 2026-10-09.
7. **SPEC-EXTRACT build:** EXT-02 rules done (`extract/validate.py`, `validation` suite: all planted faults
   caught, 0 false flags on gold; a ceiling, see `benchmarks/2026-10-07-validation-rules.md`, STORY 19). Review queue
   done (`api/review.py`: auto-approve high confidence, flagged items wait, approve-with-edits re-checks, reject;
   audit-logged; `purchase_orders` + `review_items` tables). Upload, batch and email all go through the checks
   (`submit_invoice`); minimal `/review` page. SPEC-FEEDBACK approved (3; rejections only reset).
   Loop B built (`suppressed_warnings`, notes, `review_items.extracted`, `feedback` suite): review load 48 → 44 of
   120, 0 missed; variant "only unexplained rejections reset" approved and shipped 2026-10-09: 48 → 36, 0 missed
   (`benchmarks/2026-10-07-feedback-loop-b.md`, STORY 20). Loop A needs EXT-01. Then EXT-01 structured vision extraction (OpenRouter quota) and the end-to-end number.
8. UI refactor (owner-led, last).
