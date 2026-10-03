# Build story (STAR log)

Interview-ready notes, one entry per problem worth telling: **S**ituation, **T**ask, **A**ction, **R**esult,
with the numbers and the files that prove them. Newest last. Raw numbers live in
`backend/evals/results/` and `docs/direction/BASELINE.md`; this file tells the story around them.

---

## 1. Tests that could quietly spend the real API quota (step 1, `278e229`)
- **S:** The test suite imported the app with the developer's real OpenRouter key loaded, and nothing stopped
  an unmocked call from going out. The free tier allows ~50 requests a day.
- **T:** Make it impossible for any test to touch the network or a real key.
- **A:** An autouse pytest fixture that blocks every non-loopback socket connect and DNS lookup, plus dummy
  provider keys set before the config loads.
- **R:** 0 live calls from the suite since then, enforced rather than hoped for. Every later eval (replayed
  from recordings) relies on it.

## 2. One LLM client instead of scattered calls (LLM-01, `87c5b45 … 2480fda`)
- **S:** LLM calls were spread across modules, each with its own timeout (60 s per module, so one request
  could take 120-140 s), server-side model failover, and no way to replay a call.
- **T:** One client with provider adapters, a per-request time budget, failover, and record/replay.
- **A:** `backend/llm/`: OpenRouter/Groq/Ollama adapters, a 100 s request deadline with a hard per-call
  cap, client-side failover, and a cassette that records and replays replies. `utils/llm.py` kept as a facade
  so no caller changed.
- **R:** All 342 existing tests passed unchanged; a hung provider call is now abandoned at its time slice
  instead of holding a worker.

## 3. An eval harness before any "AI improvement" (EVAL-01, `379e94a`, `71b9dae`)
- **S:** No way to say whether a change made the AI better or worse.
- **T:** Pure, unit-tested metrics and a runner that gates on regressions.
- **A:** `evals/metrics.py` (each metric checked against a hand-computed value), Wilson 95% intervals on
  every rate, a paired per-case regression gate, and a guard that refuses to run the test split outside a
  release run.
- **R:** `pytest -m eval` runs offline in CI. Numbers are always "41/50 (CI 0.69-0.89)", never a bare %.

## 4. FastAPI without breaking a single URL (API-01, `7e5908b … e66a81e`)
- **S:** Two sync gunicorn workers meant two slow LLM requests blocked everything, including `/health`. New
  agent endpoints were meant to be FastAPI.
- **T:** Put FastAPI in front of the existing Flask app with identical behaviour for auth, rate limits, CORS
  and error bodies.
- **A:** `asgi.py` mounts Flask behind FastAPI (a2wsgi); uvicorn with one worker; 36 parity tests that hit a
  Flask route and a FastAPI route for each rule.
- **R:** Flask routes return byte-identical bodies through the new server. **Bug found on the way:** the
  startup safety checks (LLM registry, key check) had never run in production, because they only ran under
  `python app.py`; they now run in the uvicorn startup hook.

## 5. Synthetic data with labels you can trust (EVAL-02, `f0a9a32 … 9c6479d`)
- **S:** No datasets: no gold SQL, no labelled invoices, no RAG corpus.
- **T:** Seeded, reproducible datasets with a dev/test split, where labels come from construction, not opinion.
- **A:** A generator for a year of transactions for 2 users, 50 hand-written gold SQL questions, 40 invoices
  rendered from ground truth with planted faults (total mismatch, duplicate, unknown vendor, bad date,
  injected instructions), 20 documents with 70 planted facts, and agent and safety cases.
- **R:** 379 labelled eval rows. **Two bugs caught by running on real Postgres:** the loader broke on a foreign
  key SQLite never enforces, and every gold query now gives identical results on SQLite and Postgres 16.
  **Also caught:** the repo's `.gitignore` silently dropped every eval image and PDF from the first commit.

## 6. Making recordings replay faithfully (EVAL-03 prep, `34d2a7f`, `73fb040`)
- **S:** Three ways a recorded eval could fail to replay: (1) the SQL prompt contains today's date, so every
  recording would go stale the next day; (2) when the free model times out, the client fails over to another
  model, but replay only looked under the first one; (3) empty model replies weren't recorded at all.
- **T:** Replay must reproduce exactly what happened live, every day.
- **A:** The prompt's "today" became pinnable (the suite pins it to the dataset's AS_OF date), replay walks the
  same failover chain, unusable replies are recorded and replayed as the same error, and every call's latency
  and tokens are collected for ops metrics.
- **R:** The SQL suite scores a fake perfect model 32/32 and a broken one 0/32 (with 32 fallbacks), proving the
  scoring before any real model is measured.

## 7. The free fallback model disappeared mid-recording (`21118f7`)
- **S:** The first live recording of the SQL baseline hit Nvidia "503: service temporarily overloaded" on the
  free Nemotron 3 Ultra, and the configured fallback, Nex N2.5 Pro, returned 404 "unavailable for free". Free
  models get retired or moved behind payment without notice, so every question used 2 requests and failed.
- **T:** Stop wasting the 50-requests-a-day quota and give the chain a fallback that works.
- **A:** Stopped the run after ~14 requests (6 questions had been recorded fine), checked OpenRouter's live
  model list, and replaced the fallback with Qwen 3.8 27B (free, a different model family, so not behind the
  same overloaded upstream). The recorder resumes with `--only-missing`, keeping the good recordings.
- **R:** Production's `render.yaml` still names the dead model: a real outage risk, found by the eval, not by
  a user. (Changing deploy config is the owner's call; flagged in PROGRESS.)
