# SPEC-EVAL: evaluation harness, datasets, baseline

Status: DRAFT for owner review. Covers roadmap **EVAL-01, EVAL-02, EVAL-03**, and builder findings 6b
**#1, #12, #14**. It also provides the harness that **LLM-02, RAG-07 and AGT-07** report through.
Source of truth for the metrics: IDEA.md section 5.

## Goal
One offline, deterministic command produces every number in IDEA.md section 5, per model tier, from committed
datasets. The README tables are generated from that output, never typed by hand. A baseline of the *current*
pipeline is measured first, and every later change is reported against it.

## Non-goals
- Evaluating live production traffic, or online/A-B evals.
- Human preference ratings or annotation tools beyond the spot-check guide.
- A dashboard: the "Trust" page is UX-03 and only reads this harness's output.
- Live LLM calls in default CI. Tests never call a live model, except the explicit record step below.

## Interfaces

**Layout** (all under `backend/`):
```
evals/
  generator/            # EVAL-02: seeded synthetic data (section "Data")
  data/                 # committed datasets (JSONL) + generated invoice/PO files
  cassettes/<tier>/     # recorded LLM responses, one JSONL per suite
  suites/               # one module per suite: sql, extraction, retrieval, generation, agent, safety
  metrics.py            # pure metric functions (no I/O)
  run.py                # python -m evals.run --tier groq --suite all
  report.py             # python -m evals.report: writes results/*.md and the README tables
  results/              # <date>-<tier>-<git sha>.json (committed for baseline and releases)
```

**Record/replay cache.** It's implemented in the LLM client (SPEC-LLM); this spec fixes the contract:
- **Key:** `sha256(provider, model, messages, tools, response_format, temperature, max_tokens, seed)`.
- **Modes:** set by `LUMEN_LLM_CACHE=replay|record|off`. In `replay`, a cache miss raises `CassetteMiss`, never
  a live call. `record` is the only mode that calls a model, and only from `evals.run --record`.
- **What is stored:** the response *and* its usage (tokens, latency), so cost and latency metrics also
  replay deterministically. The stored latency is labelled "recorded".

**Pytest wiring.**
- A marker `eval`. `pytest.ini` gains `-m "not eval"` by default, so the unit suite stays fast.
- `pytest -m eval` runs every suite in replay mode and fails on regressions (see "CI gating").
- **Prerequisite (6b #1)**, added to `tests/conftest.py` before anything else:
  - an autouse fixture that makes `requests` / `httpx` network calls raise;
  - a dummy `OPENROUTER_API_KEY` (and the other provider keys).

**Dataset schemas** (JSONL, one object per line; example ids shown):
- `sql.jsonl`: `{id, question, gold_sql, tags:[agg|filter|date|join|unanswerable], user:"u1"}`. Gold SQL runs
  on the seeded database, and the **result sets** are compared, not the SQL text (6b #14).
- `extraction.jsonl`: `{id, file, variant: clean|skew|blur|jpeg, gold:{field: value}}`.
- `retrieval.jsonl`: `{id, question, relevant_chunk_ids:[...], user}`.
- `generation.jsonl`: `{id, question, user, answerable: bool, required_facts:[...]}`.
- `agent.jsonl`: `{id, question, expected_tools:[...], expected_first_tool}`.
- `safety.jsonl`: `{id, kind: tenant|injection, user, question|document, must_not:[...]}`.

**Metrics** (`metrics.py`, pure functions, each unit-tested on hand-computed fixtures):

| Suite | Metric | Rule |
|---|---|---|
| sql | execution accuracy | Gold and predicted result sets equal as multisets (ordered only when the gold has ORDER BY); numbers compared at 2 dp. A SQL-agent **fallback counts as a failure** (6b #12). |
| sql | fallback rate | Share of questions answered from the recent-transactions fallback. |
| extraction | field-level P/R/F1 | After normalisation (ISO dates, amounts to 2 dp, trimmed/casefolded vendor names). Reported per field and per variant (clean vs degraded). |
| retrieval | recall@5, recall@10, MRR, nDCG@10 | Binary relevance; reported per ablation configuration (RAG-07). |
| generation | faithfulness, citation precision | The judge scores each claim as supported by a cited chunk or not. |
| agent | tool-selection accuracy; abstention accuracy | Abstention: an "I don't know"-style answer on unanswerable questions, and a real answer on answerable ones. |
| safety | tenant-leak count, injection-followed count | **Hard gates: both must be 0.** |
| ops | p50/p95 latency, tokens, cost per question | Cost = tokens × a price table in `evals/prices.yaml`. Free tiers report the list-price equivalent and are labelled as such. |

**Judge rule:** the judge model must be from a different model family than the system under test, and its
model id is printed next to every judged metric.

## Data (EVAL-02)
`evals/generator/` is seeded (`--seed 42` by default) and deterministic. It writes:
- Seeded DB fixtures: 2+ users, vendors, `purchase_orders` (schema owned by SPEC-EXTRACT), transactions and
  line items. It runs against SQLite (CI) or the pgserver Postgres (local), with identical data.
- Invoices: at least 20 per user, rendered to PNG/PDF from ground-truth JSON, each with its planted faults
  (total mismatch, duplicate, unknown vendor, bad date, injected instructions). Then seeded augmentations
  (skew, blur, JPEG).
- PO PDFs rendered from the same `purchase_orders` rows, plus contracts and policy PDFs for the RAG corpus.
- The question sets above. Gold SQL is written by hand for the 50 SQL questions; retrieval labels are
  LLM-drafted, then owner-verified on at least 30%.
- `evals/data/LABELLING.md`: how labels are made and verified, and which files were spot-checked.

Proposed dependencies (to be added at build time, not now): `Faker`, `reportlab`; Pillow is already present.

## Baseline (EVAL-03)
Runs the suites that apply to the **current** pipeline (sql, extraction, safety, ops) on both tiers. Retrieval
is reported as "not applicable: RAG off in production". Writes `docs/direction/BASELINE.md`, plus the committed
results JSON.

## CI gating
- **Default CI:** `pytest -q` (unit suite) **and** `pytest -m eval` in replay mode. Nothing calls the network.
- **Hard gates:** tenant leaks = 0, injection followed = 0, and no `CassetteMiss`.
- **Regression gate:** any headline metric more than 3 points below the committed baseline for the same tier
  fails. The tolerance lives in `evals/gates.yaml`.
- **Record step:** a manual job (`evals.run --record`) that the owner runs locally with Groq/Ollama keys.
  Changed cassettes are committed in their own PR.

## Acceptance criteria
1. `pytest -q` and `pytest -m eval` both pass with the network blocked and no real keys set.
2. Every metric in the table above has a unit test with a hand-computed expected value.
3. Re-running `evals.run` in replay mode produces byte-identical results JSON.
4. Changing one prompt without re-recording makes `pytest -m eval` fail with a `CassetteMiss` naming the suite
   and case id.
5. The generator produces identical files for the same seed. Its row counts match `LABELLING.md`.
6. `evals.report` regenerates the README tables between `<!-- eval:start -->` / `<!-- eval:end -->` markers.
   Every number shows its tier and model id.
7. `BASELINE.md` exists, with results for both tiers, before any AGT/RAG/EXT work merges.

## Eval hook
This spec *is* the hook for the others. Its own checks are acceptance criteria 2–4: metric unit tests,
determinism, and cassette misses.

## Open questions for the owner
- The 3-point regression tolerance is a guess; revisit it once there's a baseline.
- Whether `results/*.json` is committed for every run or only for baseline and releases. The proposal is the
  latter.
