# Build story (STAR log)

Interview-ready notes, one entry per problem worth telling: **S**ituation, **T**ask, **A**ction, **R**esult,
with the numbers and the files that prove them. Newest last. Raw numbers live in
`backend/evals/results/` and `docs/direction/BASELINE.md`; this file tells the story around them.

---

## 1. Tests that could quietly spend the real API quota (step 1, `ae7798f`)
- **S:** The test suite imported the app with the developer's real OpenRouter key loaded, and nothing stopped
  an unmocked call from going out. The free tier allows ~50 requests a day.
- **T:** Make it impossible for any test to touch the network or a real key.
- **A:** An autouse pytest fixture that blocks every non-loopback socket connect and DNS lookup, plus dummy
  provider keys set before the config loads.
- **R:** 0 live calls from the suite since then, enforced rather than hoped for. Every later eval (replayed
  from recordings) relies on it.

## 2. One LLM client instead of scattered calls (LLM-01, `11e0e52 … 6f12f3c`)
- **S:** LLM calls were spread across modules, each with its own timeout (60 s per module, so one request
  could take 120-140 s), server-side model failover, and no way to replay a call.
- **T:** One client with provider adapters, a per-request time budget, failover, and record/replay.
- **A:** `backend/llm/`: OpenRouter/Groq/Ollama adapters, a 100 s request deadline with a hard per-call
  cap, client-side failover, and a cassette that records and replays replies. `utils/llm.py` kept as a facade
  so no caller changed.
- **R:** All 342 existing tests passed unchanged; a hung provider call is now abandoned at its time slice
  instead of holding a worker.

## 3. An eval harness before any "AI improvement" (EVAL-01, `ac908d2`, `bb1a7a9`)
- **S:** No way to say whether a change made the AI better or worse.
- **T:** Pure, unit-tested metrics and a runner that gates on regressions.
- **A:** `evals/metrics.py` (each metric checked against a hand-computed value), Wilson 95% intervals on
  every rate, a paired per-case regression gate, and a guard that refuses to run the test split outside a
  release run.
- **R:** `pytest -m eval` runs offline in CI. Numbers are always "41/50 (CI 0.69-0.89)", never a bare %.

## 4. FastAPI without breaking a single URL (API-01, `0a421ae … 6f9e1d8`)
- **S:** Two sync gunicorn workers meant two slow LLM requests blocked everything, including `/health`. New
  agent endpoints were meant to be FastAPI.
- **T:** Put FastAPI in front of the existing Flask app with identical behaviour for auth, rate limits, CORS
  and error bodies.
- **A:** `asgi.py` mounts Flask behind FastAPI (a2wsgi); uvicorn with one worker; 36 parity tests that hit a
  Flask route and a FastAPI route for each rule.
- **R:** Flask routes return byte-identical bodies through the new server. **Bug found on the way:** the
  startup safety checks (LLM registry, key check) had never run in production, because they only ran under
  `python app.py`; they now run in the uvicorn startup hook.

## 5. Synthetic data with labels you can trust (EVAL-02, `d5c9cd6 … 2eb87ab`)
- **S:** No datasets: no gold SQL, no labelled invoices, no RAG corpus.
- **T:** Seeded, reproducible datasets with a dev/test split, where labels come from construction, not opinion.
- **A:** A generator for a year of transactions for 2 users, 50 hand-written gold SQL questions, 40 invoices
  rendered from ground truth with planted faults (total mismatch, duplicate, unknown vendor, bad date,
  injected instructions), 20 documents with 70 planted facts, and agent and safety cases.
- **R:** 379 labelled eval rows. **Two bugs caught by running on real Postgres:** the loader broke on a foreign
  key SQLite never enforces, and every gold query now gives identical results on SQLite and Postgres 16.
  **Also caught:** the repo's `.gitignore` silently dropped every eval image and PDF from the first commit.

## 6. Making recordings replay faithfully (EVAL-03 prep, `a9a9f55`, `c3d37da`)
- **S:** Three ways a recorded eval could fail to replay: (1) the SQL prompt contains today's date, so every
  recording would go stale the next day; (2) when the free model times out, the client fails over to another
  model, but replay only looked under the first one; (3) empty model replies weren't recorded at all.
- **T:** Replay must reproduce exactly what happened live, every day.
- **A:** The prompt's "today" became pinnable (the suite pins it to the dataset's AS_OF date), replay walks the
  same failover chain, unusable replies are recorded and replayed as the same error, and every call's latency
  and tokens are collected for ops metrics.
- **R:** The SQL suite scores a fake perfect model 32/32 and a broken one 0/32 (with 32 fallbacks), proving the
  scoring before any real model is measured.

## 7. The free fallback model disappeared mid-recording (`5ef9a34`)
- **S:** The first live recording of the SQL baseline hit Nvidia "503: service temporarily overloaded" on the
  free Nemotron 3 Ultra, and the configured fallback, Nex N2.5 Pro, returned 404 "unavailable for free". Free
  models get retired or moved behind payment without notice, so every question used 2 requests and failed.
- **T:** Stop wasting the 50-requests-a-day quota and give the chain a fallback that works.
- **A:** Stopped the run after ~14 requests (6 questions had been recorded fine), checked OpenRouter's live
  model list, and replaced the fallback with Qwen 3.8 27B (free, a different model family, so not behind the
  same overloaded upstream). The recorder resumes with `--only-missing`, keeping the good recordings.
- **R:** Production's `render.yaml` still names the dead model: a real outage risk, found by the eval, not by
  a user. (Changing deploy config is the owner's call; flagged in PROGRESS.)

## 8. Eval results that depended on whose laptop ran them (`evals/run.py`)
- **S:** The first offline replay of the SQL recordings reported 12 "missing recordings", exactly the 12
  questions the Qwen fallback had answered. The replay had read the developer's local `backend/.env`, which
  still listed an older model chain, so it looked for the wrong models.
- **T:** The same command must give the same numbers on any machine.
- **A:** `evals.run` now blanks the env model overrides for the duration of a run, so suites use only the
  committed `llm/registry.yaml` chains (with a regression test).
- **R:** Replay now reproduces the live run exactly (20/30 strict, 28/30 relaxed) and is byte-identical
  across runs. First live numbers: `docs/direction/benchmarks/2026-10-03-sql-dev-partial.md`. Headline
  finding: most strict misses are "right rows, extra columns", and the one real wrong answer comes from
  the model guessing a vendor name ("electric") instead of looking it up.

## 9. Hybrid retrieval, proven one stage at a time (RAG-01 … RAG-05)
- **S:** RAG had been disabled in production (Chroma, dense-only, embeddings over an API). There was no
  measure of whether retrieval found the right passage at all.
- **T:** Build retrieval that finds the right section of the right document, show that each stage earns its
  place, and fit a 512 MB free server.
- **A:** Section-aligned chunks with title/heading context, local `bge-small` embeddings in pgvector (numpy on
  SQLite, exact search, so both agree), per-user BM25 with a tokenizer that keeps document codes whole, RRF
  fusion, and a FlashRank cross-encoder. Each stage was measured on 104 labelled dev questions before the
  next was added, and every failure analysed.
- **R:** right section in the top 5 went **67 → 82 → 100 of 104** (recall@5 0.644 → 0.788 → 0.962; MRR
  0.593 → 0.946). Dense alone got only 16/53 purchase-order questions (it blurs PO numbers); BM25 fixed the
  document, the reranker fixed the section. A latency check showed the reranker at 1.2 s per query, so the
  candidate count was tuned on dev to 15: same accuracy at half the cost (~0.6 s). Memory: ~128 MB.
  Snapshot: `docs/direction/benchmarks/2026-10-04-retrieval-ablation-dev.md`.

## 10. When "relevant" isn't "right": abstention by identifier grounding (RAG-06)
- **S:** The plan was to abstain ("I couldn't find this in your documents") when the reranker's best score
  is low. On the dev generation set, the best possible score cut-off got only **19/26** decisions right.
- **T:** Refuse questions the user's documents can't answer, especially ones about *another user's*
  documents, without spending LLM calls.
- **A:** Looked at the misses: asked about another user's "PO-U2-202603-05", the reranker scored the asker's
  own PO "order total" sections at 0.999. A cross-encoder judges topical relevance, not whether it's the
  specific document asked for. Added a deterministic rule: if the question names a document code that
  appears in none of the retrieved passages, abstain. Kept a conservative score cut-off for off-topic
  questions, and told the model to reply NOT_FOUND as a last layer.
- **R:** **26/26** correct answer-or-abstain decisions on dev before any LLM call (both layers are local),
  and abstained questions cost zero credits. Honest limit: only 26 dev questions; the test split is the check.

## 11. Eval hygiene: two recording mistakes and the guards they produced (`7d6ea83` and the safety fix)
- **S:** With 50 free requests a day, every wasted call delays the baseline. Two mistakes in one morning:
  (1) re-recording with `--only-missing` called the first model again for 12 questions whose fallback reply was
  already recorded; (2) the safety suite inherited a developer setting (`ENABLE_CHROMA=true`) that production
  doesn't use, which added a classifier call per question and a few paid embedding calls (total cost
  $0.0000008), and made the recording unrepresentative.
- **T:** Make both mistakes impossible to repeat, not just "be more careful".
- **A:** The client now looks along the whole failover chain for an existing recording before any live call
  in record mode; the safety suite forces production's chat configuration and a test proves the old classifier
  never runs. The unrepresentative recording was thrown away rather than used.
- **R:** Re-recording costs exactly the missing calls. Measurements can no longer silently differ from
  production because of a local `.env`. (Story point: an eval is only as trustworthy as its parity with
  production; both guards are tested.)

## 12. The eval set was more specific than real users (RAG-06 fix)
- **S:** The owner's first manual test of document Q&A: the upload worked, but the question got "I couldn't find
  this in your documents". Offline, abstention had scored 26/26 on dev.
- **T:** Find out why a measured-good component failed its first real user.
- **A:** Replayed plausible questions against the uploaded contract. Retrieval found the right section every
  time, but the reranker scored short generic questions near zero ("What is the notice period?" 0.003, "What is
  the monthly fee?" 0.414) and the 0.5 cut-off refused them. Every eval question had named its vendor or PO,
  which keeps cross-encoder scores high. Removed the score cut-off (off-topic questions also score ~0.000, so no
  cut-off separates them), kept identifier grounding and the model's NOT_FOUND, logged every abstention reason,
  and added a regression test with the exact failing question.
- **R:** Short questions are answered; refusing an off-topic question now costs one LLM call instead of zero.
  Lesson for the story: an offline eval only covers the questions you wrote, so the first real user is part
  of the eval. Next: generic, underspecified questions go into the generation suite.

## 13. Choosing models from data, not reputation (LLM-02)
- **S:** With a Groq key available, three candidate models (gpt-oss-120b, qwen3.8-27b, gpt-oss-20b) and an
  OpenRouter baseline (free Nemotron 3 Ultra). Groq's free tier caps tokens per minute (8K).
- **T:** Pick each tier's default model with evidence, and record without the rate limits distorting results.
- **A:** `python -m evals.bench` runs a suite once per candidate, each alone in the chain (no fallback), and
  writes `docs/direction/LLM-BENCH.md`. A "patient" record mode waits out per-minute limits on the same model
  instead of failing over mid-baseline.
- **R:** On the 32 dev SQL questions all three Groq models tie (28-29/32, overlapping CIs); gpt-oss-120b leads
  with zero fallbacks. Same accuracy as Nemotron, **3-10× faster** (p95 3.0 s vs 8.9 s). Story point: the
  honest conclusion was "they're tied, pick on secondary criteria", and the choice is re-checked on tool calling.

## 14. The agent's first measurement found a wasted-call design flaw (AGT-07)
- **S:** The first agent recording showed most `run_sql` calls rejected: "Query must filter by authenticated
  user_id". The model never sees the user id (by design), so it couldn't write the filter.
- **T:** Keep tenant isolation intact without making the model guess an id it isn't allowed to know.
- **A:** The filter requirement was defence in depth on top of server-side scoping (`_scope_to_user` already
  restricts every table to the user's rows). The agent's `run_sql` now relies on that scoping; a literal reference
  to any *other* user id is still rejected, and the rejection reason goes back to the model so it can correct
  itself. Recording was stopped and redone rather than measuring a broken design.
- **R:** Rejections dropped from most SQL calls to a handful; the existing SQL-isolation tests pass unchanged,
  plus new tests proving an unfiltered query only sees the caller's rows.

## 15. A recorder bug that would have made CI lie, caught by replaying once (AGT-07)
- **S:** The agent recording finished (22/24 routing, 28/28 abstention), but replaying it offline failed for 25 of
  28 cases with "missing recording".
- **T:** Recordings must replay exactly, or every CI number built on them is fiction.
- **A:** Found the cause: when Groq said "wait 3 s", the retried request was counted as a *second identical
  request*, so its reply was stored under `key#1`, which replay never asks for. The same bug had hit the Groq SQL
  bench. Fixed it (a logical call is counted once, however many rate-limit retries), added a regression test, and
  repaired the existing recordings (renamed 53 + 56 entries) instead of spending another day of tokens.
- **R:** Every recording now replays to exactly the live numbers (agent 22/24 and 28/28, Groq SQL 29/32, OpenRouter
  SQL 29/32, bench tables byte-identical). Story point: "record once, replay forever" only holds if you verify
  the replay immediately after recording.

## 16. Giving the agent the schema up front: a quarter fewer tokens, and a lesson in prompt side effects (AGT-07)
- **S:** The agent guessed columns (`amount`, `vendor`, `tax_type`) and even a `vendors` table: 8 rejected or failed
  queries and 7 `get_schema` calls across 28 dev questions; "average electricity bill" took 5 LLM calls.
- **T:** Cut the wasted calls without losing routing accuracy, measured before/after on the recorded `agent` suite.
- **A:** Put a compact schema in the system prompt, generated from the models so it can't drift (a test checks
  every column is listed and `user_id` isn't). The first recording cut calls but broke routing (18/24): seeing an
  `invoice_number` column, the model sent PO numbers to `get_invoice` and gave up. Read each miss, added general
  routing lines (PO numbers -> documents, duplicate charges -> anomalies, try the other likely tool before giving
  up), re-recorded, replayed both recordings offline to identical numbers.
- **R:** Calls 73 -> 54 (2.6 -> 1.9 per question), tokens/question 2,961 -> 2,233 (-25%), p95 5.5 s -> 3.3 s, zero
  failed SQL, zero `get_schema` calls; routing 21/24 (was 22/24, inside the CI). Every remaining miss read by hand
  is a label or scorer artefact, which is a metric decision left to the owner. Story point: a prompt fix has side
  effects elsewhere; only an eval that covers every route shows them.

## 17. Fixing the grader without flattering the model (AGT-07)
- **S:** After the prompt change, all five remaining "misses" turned out, read by hand, to be grader errors: correct
  vendor totals answered from the vendor lookup, a grounded "no duplicate charges found" read as a refusal, and a
  polite refusal the regex didn't recognize.
- **T:** Fix the grader so it measures the agent, not its phrasing, without inflating the numbers.
- **A:** Two rules, each unit-tested on the real cases: the lookup answer counts as the SQL route; "not found" is a
  refusal only if the right tool was never called. Re-scored *all* recordings (before, v1, v2) with the same grader,
  offline, and checked it still catches v1's three real routing mistakes.
- **R:** Before and v2 both 24/24 routing, 28/28 abstention; v1 21/24 and 26/28. Same accuracy, 27% fewer calls and
  25% fewer tokens: the prompt change is a pure efficiency win. Story point: when a metric moves, read the misses
  before believing it, and re-score the baseline with any grader change.
