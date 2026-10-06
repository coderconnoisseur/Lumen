# Build progress

Resume from this file plus `IDEA.md` and `specs/`. Branch: `feat/ai-eng-direction` (not pushed).
Tests: `cd backend && env -u OPENROUTER_API_KEY python -m pytest -q` and `... python -m pytest -q -m eval` (CI runs both).

## Status

| Step | Module | State | Commits |
|---|---|---|---|
| 1 | Network block + dummy keys (6b #1) | ✅ done | 278e229 |
| 2 | LLM-01 provider abstraction, deadline, cassette | ✅ done | 87c5b45 … 2480fda |
| 3 | EVAL-01 harness skeleton | ✅ done | 379e94a, 71b9dae |
| 4 | API-01 FastAPI step 1 + uvicorn | ⏳ next | |
| 5 | EVAL-02 generator + datasets, EVAL-03 baseline, LLM-02 bench | ⬜ | |
| — | SPEC-RAG (full review), then SPEC-AGENT / EXTRACT / UX one-pagers | ⬜ | |

Last commit: `71b9dae` Add the eval runner with paired regression gating and pytest -m eval.
Suite: 342 passed, 1 deselected; `pytest -m eval`: 1 passed.

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

## Decisions made while building (routine; recorded for review)
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
API-01: `backend/asgi.py` (FastAPI outer app, Flask mounted via `a2wsgi`), uvicorn with 1 worker, and the parity
tests for auth, rate limits, CORS and the error body. Stop at step 1. New dependencies when it lands:
`fastapi`, `uvicorn[standard]`, `a2wsgi`, plus `slowapi` or a small `limits` decorator.
