# SPEC-LLM: providers, tiers, cassette cache, request deadline, API step 1

Status: DRAFT for owner review. Covers roadmap **LLM-01, LLM-02**, builder findings 6b **#4, #7, #11, #15**,
the record/replay contract from SPEC-EVAL, and a new **API-01** (FastAPI step 1 + gunicorn → uvicorn).

## Goal
One LLM client that can talk to Ollama, Groq or OpenRouter, chosen by configuration rather than code. It must:
- fail over between providers;
- record and replay every call, so evals and CI never touch the network;
- respect a whole-request time budget.

Separately: new API routes are written in FastAPI, with the existing Flask app mounted inside it, without any
current route or test changing behaviour.

## Non-goals
- Embeddings and reranking. They are local models and belong to SPEC-RAG (fastembed, FlashRank).
- Streaming responses (that's for SPEC-UX, if ever).
- Porting the existing Flask blueprints to FastAPI. **This is the explicit cut line**: steps 2–4 of the
  migration are listed as "next" in the README, not done here.
- Paid-provider support beyond what OpenRouter already gives.

## Interfaces

**Package `backend/llm/`** (new). `utils/llm.py` stays as a thin facade, so existing callers don't change.
```
llm/
  errors.py      # LLMError (same kinds + is_fatal), adds DEADLINE (fatal)
  providers.py   # Provider adapters: base_url, key env, status->kind map, reasoning switch, key check
  registry.yaml  # model chains per tier x role (env vars may override any entry)
  client.py      # complete(): failover, retries, deadline, cassette, telemetry
  cassette.py    # record/replay store (contract in SPEC-EVAL)
  deadline.py    # request-scoped wall-clock budget
```

**`llm.client.complete(...) -> LLMResult`**
```python
complete(messages, *, role="text", tools=None, response_format=None,
         temperature=0.0, max_tokens=500, timeout=30, retries=1) -> LLMResult
LLMResult(text, tool_calls, provider, model, usage{prompt,completion,reasoning},
          latency_s, cached: bool)
```
- **Roles:** `text`, `vision`, `judge`. `messages` accepts the existing content-part lists (text + image_url).
- **Transport:** the `openai` SDK (already in `requirements.txt`), with a per-provider `base_url` and
  `max_retries=0`. We own retries and failover.
- **Compatibility:** `utils.llm.chat_completion(prompt, **kw)` keeps its signature and returns `.text`. It maps
  `model` / `fallback_models` onto an explicit chain, so the current call sites keep working.

**Tiers** (`LUMEN_LLM_TIER=ollama|groq|openrouter`; default `openrouter` until LLM-02 picks one):

| Tier | Provider | Use | Notes |
|---|---|---|---|
| `ollama` | `http://localhost:11434/v1` | dev plumbing only | Thinking off for qwen3 (`think: false` / `/no_think`). No reported numbers. |
| `groq` | `https://api.groq.com/openai/v1` | evals, CI recordings, demo | Free tier: rate limited (requests and tokens per minute and per day). |
| `openrouter` | existing | fallback; vision until Groq vision is confirmed | Keeps `reasoning: {enabled:false}`. |

**Registry.** `registry.yaml` lists an ordered model chain per tier and role. Real model ids are filled in
from LLM-02's results, not guessed here.
```yaml
groq:       {text: [..], vision: [..], judge: [..]}
ollama:     {text: [qwen2.5:3b], vision: [], judge: []}
openrouter: {text: [..], vision: [google/gemma-4-31b-it:free, qwen/qwen3.8-27b:free], judge: [..]}
```
- **Failover order:** the chain within the tier first, then the OpenRouter chain for the same role. Each
  entry is `provider:model`.
- **Judge rule (enforced at startup):** the first judge model must not share a model family with the first
  text model. The family comes from a `family:` field per entry.
- **Vision pinning (6b #4):** `openrouter/free` is no longer in any default chain. It's allowed only as an
  explicit env override, and then a warning is logged at startup. The README notes that a local `.env` with
  `LLM_VISION_MODEL=openrouter/free` overrides the pinned chain.

**Provider adapters (6b #11).** Each adapter owns its quirks:
- **Reasoning off:** OpenRouter uses `reasoning:{enabled:false}`; Groq uses `reasoning_effort` /
  `reasoning_format` (on the models that support them); Ollama uses `think:false`.
- **Error and key handling:** each adapter maps HTTP status to `LLMError.kind` and has its own key check.
  Groq and Ollama use `GET /models` (free).
- **What's dropped:** OpenRouter's `models` fallback array. Failover is client-side for every provider, so
  failover behaviour is identical across tiers.

**Failover and retries.**
- **Failover:** on `RATE_LIMITED`, `UNAVAILABLE` or `CONFIG`, the client moves to the next chain entry. On
  `AUTH` or `CREDITS`, it skips that provider for the rest of the request.
- **Retries:** `BAD_RESPONSE` retries the same entry `retries` times.
- **429s:** honour `Retry-After` only if it fits in the remaining deadline; otherwise fail over.

**Request deadline (6b #7).**
- **Setting the budget:** `with request_deadline(seconds)` sets a context variable. Flask (`before_request`) and
  FastAPI (a dependency) set **100 s** per request by default, below gunicorn/uvicorn's 120 s. `/analyze` and
  the chat path inherit it, which closes the per-module 60 s gap.
- **Applying it:** each attempt uses `min(timeout, remaining − 2 s)`. With less than 3 s left, the client raises
  `LLMError(DEADLINE)` without calling.
- **Hard cap:** the HTTP call runs in a worker thread and is abandoned when its slice expires, because
  `requests`/`httpx` timeouts are per read, not total.

**Cassette (contract from SPEC-EVAL).**
- `LUMEN_LLM_CACHE=replay|record|off`; the key is
  `sha256(provider, model, messages, tools, response_format, temperature, max_tokens, seed)`.
- `with cassette_scope(suite)` selects `evals/cassettes/<tier>/<suite>.jsonl`.
- **On a hit:** the result comes back with `cached=True` and the recorded usage and latency.
- **On a miss in replay mode:** the client raises `CassetteMiss`; it never makes a live call.
- **Default:** `off` in the app, `replay` under `pytest -m eval`.

**Telemetry.** The existing INFO line gains `provider=` and `cached=`. Usage is returned on `LLMResult`, so
SPEC-EVAL can compute cost without parsing logs.

**API-01: FastAPI step 1** (`backend/asgi.py`, new).
- **Structure:** FastAPI is the outer app. New routes live under `backend/api/` (e.g. `/api/agent/*`,
  `/api/review/*`). The existing Flask `app` is mounted last at `/`, so every current URL resolves exactly
  as today.
- **Mount:** through `a2wsgi.WSGIMiddleware`. Starlette's own WSGIMiddleware still ships, but it's deprecated.
- **Server:** `uvicorn asgi:app --workers 1` replaces `gunicorn ... app:app` in `render.yaml` and the docs.
  - One worker fits Render's 512 MB.
  - Sync Flask runs in uvicorn's threadpool, so a slow LLM request no longer blocks `/health` (6b #15).
  - With no gunicorn worker-kill, the 100 s request deadline above becomes the time limit.
- **Parity rule** (each point tested on one Flask route and one FastAPI route):
  - **Auth:** a FastAPI dependency calls the same `utils.auth.verify_token`, with the same 401 body and codes.
  - **Rate limits:** the same per-user key and the same limits, from the same `limits` storage that
    Flask-Limiter uses. The 429 body has the same shape.
  - **CORS:** handled **once**, by FastAPI's CORSMiddleware with `ALLOWED_ORIGINS`. Flask-CORS is switched off
    when Flask runs mounted, to avoid duplicate headers.
  - **Errors:** the same `{success:false, error, code}` body, and `LLMError` maps to the same 429/502/503.
- **Proposed dependencies** (added at build time, not now): `fastapi`, `uvicorn[standard]`, `a2wsgi`,
  `slowapi` (or a small `limits` decorator), `pyyaml`.

## LLM-02: mini-bench
- **Cases:** 20 SQL, 10 tool-call and 10 extraction cases from SPEC-EVAL's **dev** split, recorded once per
  candidate.
- **Candidates:** about 3 models per tier. They include a Groq vision check, and the extraction column stays
  OpenRouter-only if Groq has no usable vision model.
- **Measures:** accuracy with counts and CIs, p50/p95 latency, the requests used per run (against free-tier
  quota), and process RSS with the client loaded.
- **Output:** `docs/direction/LLM-BENCH.md` plus the filled-in `registry.yaml`. Defaults per tier and role are
  chosen from this table.

## Acceptance criteria
1. Every existing test passes unchanged through the `utils.llm` facade. CI makes no network calls (the
   SPEC-EVAL conftest fixture).
2. `LUMEN_LLM_TIER` switches provider with no code change. A test per adapter covers the reasoning switch, the
   status→kind map and the key check, all mocked at the HTTP layer.
3. Failover tests: 429 on entry 1 → entry 2; AUTH skips that provider; BAD_RESPONSE retries the same entry;
   Retry-After longer than the remaining deadline → failover.
4. Deadline tests, with a fake clock and a stalled transport: a hung call is abandoned at its slice; under 3 s
   left raises `DEADLINE` with no call; `/analyze` with `use_llm=true` can't exceed 100 s.
5. Cassette tests: record, then replay gives identical `LLMResult` (`cached=True`); a miss in replay raises
   `CassetteMiss`; the key changes when any keyed field changes.
6. A startup check fails if the judge's first model shares a family with the text model's first model, and
   warns if `openrouter/free` appears in any chain.
7. API-01: an existing Flask route reached through `asgi:app` returns byte-identical responses to the plain
   Flask test client. The parity tests pass for auth, rate limits, CORS preflight and the error body.
8. `LLM-BENCH.md` exists and every default in `registry.yaml` cites its row.

## Eval hook
- **LLM-02:** the mini-bench runs through SPEC-EVAL's harness (record once, then replay).
- **Every model choice** is a row in the bench table.
- **Cost and latency metrics** in SPEC-EVAL come from `LLMResult.usage` and `latency_s`, recorded in the
  cassettes.
