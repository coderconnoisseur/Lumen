# Lumen Direction Reset: Roadmap and Ordered Actionables

Status: DRAFT for owner review. Written 2026-10-03 after an external audit of the repo.
Nothing here has been implemented. Order of work: **idea -> specs -> module-level TODO -> build.**

---

## 0. Why we are resetting

The existing roadmap (`PLAN.md` phases A-F, `TODO.md`) is a SaaS production-hardening plan: auth, tenancy,
Postgres, deploy, frontend polish. It is done or nearly done, and it was good work. But it does not make Lumen
read as an **AI engineering** project. A grep of `backend/` for `tool_call`, `tools`, `json_schema`,
`response_format`, `eval`, `langfuse`, `pydantic`, `benchmark` returns nothing.

| AI-engineer signal | Today |
|---|---|
| Agents / tool calling | None. Fixed pipeline: classify -> SQL -> synthesize. The LLM never picks an action. |
| Evals | None. Unit tests mock the LLM; nothing measures answer quality. |
| Structured outputs | None. |
| Tracing / cost | One latency log line per call. |
| RAG | Chroma + dense search only. **Disabled in production** (`ENABLE_CHROMA=false` in `render.yaml`). |
| Memory | Chat history is persisted; no summarisation or retrieval over it. |

Keep (real signal): `sqlglot` SQL validation and per-user scoping (`ai/sql_agent.py`), the reasoning-off
latency diagnosis (`utils/llm.py`), JWT auth, CI, mocked-LLM test suite.

Freeze (low value for the goal): Gmail OAuth, app-wide theme work, dead footer links, a11y polish,
`@supabase/ssr` cookies, further Postgres dialect edge cases, the pile of overlapping markdown docs.

---

## 1. PHASE 0: Idea clarity (do this first, with the owner, ~1 session)

Method: run `superpowers:brainstorming` with the owner. Output is a one-page `docs/direction/IDEA.md`.
No code before this exists.

### 1.1 Decision zero: which "Lumen"?

There are two diverging lineages in this repo. Both are called Lumen.

| | Invoice / finance-ops Lumen | `v2/intelligence-agent` |
|---|---|---|
| Idea | Read invoices, answer spend questions, detect anomalies, forecast | Personal portfolio intelligence: news ingest, relevance, impact analysis, briefings, scenario sim |
| State | Live on `refactor` and the `fix/*` branches; the one on the resume | Last commit 2026-07-24, 57/60 modules, deploy steps owed by owner |
| Natural RAG use case | Weak today (structured data); needs an added document corpus | Strong (news text is unstructured) |
| Demo reliability | High: synthetic data, no live dependencies | Lower: depends on live news APIs, rate limits, ongoing cost |
| Eval-ability | High: SQL results and extracted fields have exact ground truth | Harder: "relevance" and "impact" labels are subjective |
| Already on the resume | Yes | No |

This is a project for the owner's general resume, not for any one employer or job description. It is judged
on three things: does it tell one clear story, can its claims be measured, and will the demo work every time.

Auditor recommendation: **invoice / AP-automation Lumen is the core.** Exact ground truth makes evals
credible, synthetic data keeps the demo reliable and free of PII, and it is already on the resume. v2 has a
better natural RAG story, so that is a real trade-off for the owner to weigh in Phase 0. Either way, treat v2
as a quarry: its guardrail, eval, and cited-chat modules may be reusable, but that branch has **not been
audited** (403 files diverged from `main`). Do not merge or resurrect it without a separate review.

### 1.2 Questions the owner must answer (with proposed defaults)

1. **One-sentence product.** Proposed: *"Lumen is an accounts-payable copilot for small finance teams. It reads
   invoices, validates them against purchase orders and vendor history, flags exceptions for human review,
   and answers spend questions with cited evidence."*
2. **Who uses it, and what is the 90-second demo?** Proposed demo: upload 5 invoices (one bad) -> extraction
   with confidence -> flagged exception lands in a review queue -> ask "why was INV-1042 flagged and what did
   we pay this vendor last quarter?" -> answer with citations and visible tool steps.
3. **What is RAG for?** Transactions are structured, so SQL beats RAG for them. RAG earns its place only over
   **unstructured text**: invoice OCR full text, line-item descriptions, notes, uploaded POs, vendor contracts,
   payment-terms and policy PDFs. Proposed: add a "documents" corpus so retrieval is genuinely needed and the
   agent has to choose between `run_sql` and `search_documents`.
4. **Autonomy boundary.** Proposed: agent is read-only plus "flag / propose"; a human approves anything that
   changes state (mark paid, approve, delete).
5. **Success metrics** (targets are placeholders until the baseline exists):
   text-to-SQL execution accuracy, extraction field-level F1, retrieval recall@5 and nDCG@10, answer
   faithfulness, tenant-leak count (must be 0), p95 latency, cost per question.
6. **Data.** Real invoices contain PII. Demo and eval data must be **synthetic**; decide who generates the 20+
   labelled invoice images/PDFs.
7. **Deploy target.** Render free web service is ~512 MB RAM. That constrains reranker and embedding choices
   (section 4). Decide now: stay on Render, or move the heavy parts elsewhere.

### 1.3 Exit criteria for Phase 0
`IDEA.md` merged; questions 1-7 answered; one named canonical branch; the other agent unblocked (see
`00-HANDOFF-PROMPT.md`).

---

## 2. PHASE 1: Specs (one short spec each, via `superpowers:writing-plans` / `product-management:write-spec`)

Each spec states goal, non-goals, interface, acceptance criteria, and its eval hook. Suggested set:

| Spec | Covers |
|---|---|
| SPEC-LLM | Provider abstraction, model tiers, record/replay cache, judge-model rule |
| SPEC-EVAL | Datasets, metrics, CI gating, report format, how numbers reach the README |
| SPEC-RAG | Corpus, chunking, indexes, hybrid retrieval, rerank, citations, isolation |
| SPEC-AGENT | Tool schemas, loop, guardrails, memory, tracing, failure handling |
| SPEC-EXTRACT | Structured schema, validation rules, confidence, review queue, injection handling |
| SPEC-UX | Evidence-first chat, review queue, trust/eval page, onboarding, one design system for the core path |

---

## 3. LLM provider strategy (free-first)

Goal: unlimited cheap iteration, reproducible numbers, no dependence on one free tier.

Both Groq and Ollama expose OpenAI-compatible endpoints, and `openai` is already in `requirements.txt`, so
one client with a swappable `base_url` covers everything:

| Tier | Provider | Base URL | Use |
|---|---|---|---|
| Dev loop | Ollama (local) | `http://localhost:11434/v1` | Plumbing, UI work, schema/tool-wiring, retries. Unlimited and free. |
| Evals, CI, demo | Groq (free tier) | `https://api.groq.com/openai/v1` | Real quality numbers; fast. Rate-limited (RPM/TPM/daily), so cache. |
| Judge | A different, stronger model than the system under test | Groq large model | LLM-as-judge for faithfulness; never judge a model with itself. |
| Fallback | OpenRouter (existing) | existing | Keep as one more provider in the chain. |

Candidate Groq models (verify the current list and limits at console.groq.com; they change):
`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `openai/gpt-oss-20b` / `-120b`, `qwen/qwen3-32b`.

### Is Ollama + qwen2.5:3b good enough?
Installed locally: `qwen2.5:3b`, `qwen3:4b` on a GTX 1650 Ti (4 GB VRAM).

- **Good enough for:** wiring and iterating on the agent loop, JSON-mode/structured-output plumbing, UI, tests.
- **Not trustworthy for:** text-to-SQL on this schema, reliable multi-step tool calling, faithfulness judging.
  3B models routinely emit malformed tool args or wrong joins. Do not report benchmark numbers from them.
- `qwen3:4b` reasons by default; disable thinking (`think:false` / `/no_think`), the same lesson as
  `REASONING_OFF` in `utils/llm.py`.
- A 7B (e.g. `qwen2.5:7b` or `qwen2.5-coder:7b`, 4-bit) can run on 4 GB with partial CPU offload but slowly.

**This is a claim to verify, not a fact.** Task LLM-02 runs a mini-bench (20 text-to-SQL questions, 10
tool-call cases, 10 extraction cases) across candidates and the choice is made from that data.

Rules:
1. The model that produced a reported number is the model named next to it in the README.
2. Temperature 0; fixed seeds where supported; every call goes through the record/replay cache keyed by
   `hash(model, messages, params)` so CI is free and deterministic.
3. Demo and eval data are synthetic. Do not send real invoices to any third-party free tier.
4. Treat 429 as expected: the existing `LLMError.RATE_LIMITED` handling stays, add backoff and provider failover.

**Embeddings:** Groq has none. Use local ONNX embeddings via `fastembed` (`BAAI/bge-small-en-v1.5`, 384-d,
roughly 130 MB) in dev and prod, or Ollama `nomic-embed-text` in dev only. This also removes the
embedding-API quota that currently sits behind the disabled-in-prod RAG.

---

## 4. RAG: making it robust

### 4.1 Target pipeline

```
ingest -> normalise -> chunk -> index (dense + sparse) ->
query -> [optional rewrite] -> hybrid retrieve -> RRF fuse -> tenant filter ->
cross-encoder rerank -> context assembly w/ citations -> answer -> faithfulness check
```

| Stage | Choice | Notes |
|---|---|---|
| Corpus | Per-invoice "card" doc + line-item docs + uploaded POs/contracts/policies | Metadata on every chunk: `user_id`, `doc_type`, `vendor`, `date`, `source_id`, `embedding_model` |
| Chunking | Cards: one chunk each. Long docs: ~300-500 tokens, ~15% overlap, split on headings/paragraphs | Dedupe by content hash |
| Dense | Move Chroma -> **pgvector** (prod is already Postgres, durable, tenant filter in SQL) | Chroma stays acceptable for local dev if pgvector is a pain; decide in SPEC-RAG |
| Sparse | **BM25** via `bm25s` or `rank_bm25`, built per tenant from the DB and cached; invalidate on write | Honest limit: fine to ~tens of thousands of chunks per user. Postgres FTS (`ts_rank`) is *not* true BM25; ParadeDB `pg_search` is, but not on Render |
| Fusion | **Reciprocal Rank Fusion**, k=60, top-50 from each retriever | No score normalisation needed |
| Rerank | Cross-encoder over top ~30 -> top 5 | Dev/quality: `BAAI/bge-reranker-v2-m3` (fits 4 GB GPU in fp16, too heavy for Render free). Prod on 512 MB: **FlashRank** (ONNX MiniLM/TinyBERT, tens of MB, CPU). Hosted option: Cohere/Jina rerank free tiers |
| Isolation | `user_id` filter enforced **server-side in the retriever**, never from the prompt | Dedicated leak test |
| Answering | Must cite chunk ids; "no answer" is a valid, tested outcome | Judge checks every claim maps to a cited chunk |

Add only if the ablation shows retrieval is the bottleneck: query rewriting / multi-query, HyDE,
metadata-aware query routing. Skip GraphRAG and late-interaction models.

### 4.2 Evaluation (what makes it "robust" rather than "fancy")
- **Retrieval set:** 60-100 questions with labelled relevant chunk ids (LLM-generated from chunks, then
  human-verify at least 30%). Metrics: recall@5, recall@10, MRR, nDCG@10.
- **Ablation table in the README:** dense only -> + BM25 (RRF) -> + reranker. Report each step honestly,
  including steps that did not help.
- **Generation set:** faithfulness, citation precision, correct abstention on unanswerable questions.
- **Safety set:** prompt-injection text inside an invoice/PO; cross-tenant queries must return nothing.
- **Ops:** index versioning (store embedding model id; `reindex` script), idempotent upserts, empty-index
  fallback to SQL, per-stage latency budget (retrieve < 150 ms, rerank < 300 ms, targets to be confirmed by
  measurement).

### 4.3 Constraint to settle early
Render free (~512 MB): `fastembed` + FlashRank + one gunicorn worker is plausible; `bge-reranker-v2-m3` is
not. Measure memory in LLM-02/RAG-05 before committing. If it does not fit, run RAG-heavy demo locally or on a
bigger host and say so.

---

## 5. PHASE 2: Module-level TODO (draft, to be finalised after Phases 0-1)

Format: ID - what - depends on - done when. Tracks can run in parallel where dependencies allow.

### Track A: Foundations (idea-independent; safe to start once the owner says go)
- **LLM-01** Provider abstraction in `utils/llm.py` (OpenAI-compatible, per-tier config, failover, keeps
  `LLMError` semantics). Done when: one env var switches Ollama / Groq / OpenRouter; tests cover failover.
- **LLM-02** Mini-bench of candidate models (+ memory measurement). Done when: a table of model vs task
  accuracy/latency is committed and a default per tier is chosen from it.
- **EVAL-01** Harness + record/replay cache + CI job. Done when: `pytest -m eval` runs offline from cached
  responses and prints a metrics table.
- **EVAL-02** Datasets: seeded synthetic DB, 50 SQL questions, 20 labelled invoices, routing/injection cases.
  Depends: IDEA.md (domain). Done when: files committed with a schema and a labelling guide.
- **EVAL-03** Baseline run on the *current* pipeline. Done when: baseline numbers are in `docs/direction/BASELINE.md`.
  Everything after this is measured against it.

### Track B: RAG (depends: IDEA Q3, EVAL-01)
- **RAG-01** Corpus schema + chunker + metadata.
- **RAG-02** Local embeddings (`fastembed`) + pgvector index + reindex script.
- **RAG-03** BM25 per-tenant index with cache invalidation.
- **RAG-04** Hybrid retrieve + RRF.
- **RAG-05** Cross-encoder rerank (FlashRank prod path, bge dev path); memory + latency measured.
- **RAG-06** Citation-grounded answering + abstention.
- **RAG-07** Retrieval eval + ablation table. Done when: recall@5 / nDCG@10 per configuration committed.
- **RAG-08** Tenant-leak and prompt-injection tests. Done when: zero leaks across the safety set.
- **RAG-09** Turn RAG on in production config (remove `ENABLE_CHROMA=false` dependency).

### Track C: Agent (depends: LLM-01, EVAL-03)
- **AGT-01** Typed tool schemas (Pydantic): `get_schema`, `run_sql`, `search_documents`, `get_anomalies`,
  `forecast`, `get_invoice`.
- **AGT-02** Tool-calling loop: bounded steps, bounded retries, error feedback to the model, step trace returned to UI.
- **AGT-03** Guardrails: existing `sqlglot` validator wrapped as the `run_sql` gate; row/time limits.
- **AGT-04** Remove the classifier path (its own comment says it is pure latency when RAG is off); re-run evals.
- **AGT-05** Memory: per-user conversation summarisation + recall tests.
- **AGT-06** Tracing (Langfuse or OpenTelemetry): per-request cost, latency, tool steps.
- **AGT-07** Delta report vs baseline.

### Track D: Extraction and validation (depends: EVAL-02)
- **EXT-01** Structured extraction (JSON schema + Pydantic) replacing free-text parsing.
- **EXT-02** Validation rules: totals vs line items, duplicate detection, vendor/PO match, date sanity.
- **EXT-03** Confidence scores + human review queue (state machine: extracted -> flagged -> approved/rejected).
- **EXT-04** Injection-in-invoice test cases.

### Track E: UI/UX (depends: SPEC-UX; each item ships with its backend piece)
- **UX-01** Evidence-first chat: citations as clickable chips, "show your work" panel (tool steps + validated SQL).
- **UX-02** Review queue page for flagged invoices (side-by-side image and extracted fields, approve/edit/reject).
- **UX-03** "Trust" page: latest eval table, retrieval ablation, cost/latency chart. Doubles as the recruiter view.
- **UX-04** One-click sample-data onboarding (synthetic workspace) so a visitor sees value without uploading.
- **UX-05** Unify design on the core path only (dashboard, upload, review, chat). Landing/marketing is last.
- **UX-06** Deploy, 90-second demo video, README rewritten around the results tables.

### Track F: Repo hygiene (low effort, do alongside)
- **HYG-A** Collapse overlapping docs into README + ARCHITECTURE; delete `DOCUMENTATION_COMPLETE.md`,
  `DOCUMENTATION_INDEX.md`, and other duplicates once their content is merged.
- **HYG-B** Name one canonical branch; land or park `fix/ai-analytics-postgres`; archive `backup/*`.

---

## 6. Ordered actionables (start here)

Gated = needs the owner. Parallel = can run at the same time as the item above it.

1. **(Owner, 5 min)** Paste the prompt in `00-HANDOFF-PROMPT.md` to the other agent so it stops and reports status.
2. **(Owner, 5 min)** Decide which branch is canonical and whether the in-flight work there is landed or parked.
3. **(Gated, ~1 session)** Phase 0 brainstorm -> `IDEA.md`. Answer section 1.2 questions 1-7.
4. **(Parallel to 3)** LLM-01 and LLM-02: provider abstraction and model mini-bench. These do not depend on the idea.
5. **(Parallel to 3)** Groq key + local Ollama sanity check; confirm which models are actually available to you.
6. **After 3:** Phase 1 specs, in this order: SPEC-EVAL, SPEC-LLM, SPEC-RAG, SPEC-AGENT, SPEC-EXTRACT, SPEC-UX.
7. **After specs:** finalise section 5 into a numbered TODO with owners and dates; then EVAL-01 -> EVAL-02 -> EVAL-03.
8. **Then build in this order:** Track C (AGT-01..04) and Track B (RAG-01..05) in parallel, then Track D, then Track E, with UI items shipping alongside their backend pieces.
9. **Ship:** HYG-A, UX-06. Update the resume bullets only with numbers from the eval tables.

## 7. Risks
- **Free-tier limits** make evals flaky -> record/replay cache and a small paid-credit fallback.
- **Small local models** give misleading dev results -> never report numbers from them.
- **Memory on Render free** may rule out rerankers -> measure before committing.
- **Scope creep from the v2 lineage** -> out of scope until Phase 0 says otherwise.
- **Resume honesty** -> do not claim RAG in production until RAG-09 is true.
