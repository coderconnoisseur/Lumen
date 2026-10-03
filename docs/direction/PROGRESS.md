# Build progress

Resume from this file plus `IDEA.md` and `specs/`. Branch: `feat/ai-eng-direction` (not pushed).
Tests: `cd backend && env -u OPENROUTER_API_KEY python -m pytest -q` (plus `pytest -m eval` once EVAL-01 lands).

## Status

| Step | Module | State | Commits |
|---|---|---|---|
| 1 | Network block + dummy keys (6b #1) | ✅ done | 278e229 |
| 2 | LLM-01 provider abstraction, deadline, cassette | ✅ done | 87c5b45 … 2480fda |
| 3 | EVAL-01 harness skeleton | ⏳ next | |
| 4 | API-01 FastAPI step 1 + uvicorn | ⬜ | |
| 5 | EVAL-02 generator + datasets, EVAL-03 baseline, LLM-02 bench | ⬜ | |
| — | SPEC-RAG (full review), then SPEC-AGENT / EXTRACT / UX one-pagers | ⬜ | |

Last commit: `2480fda` Route existing LLM callers through the new client. Suite: 318 passed.

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
EVAL-01: `backend/evals/` skeleton, `metrics.py` with hand-computed unit tests, `run.py`, `pytest -m eval`
wiring (default runs exclude the marker).
