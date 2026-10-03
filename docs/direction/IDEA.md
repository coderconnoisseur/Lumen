# Lumen: the idea (Phase 0)

Status: DRAFT for owner approval. Answers to roadmap section 1.2, agreed 2026-10-03.
Lineage: the invoice Lumen (`refactor` and the `fix/*` branches). `v2/intelligence-agent` is out of scope.
Purpose: a resume project for the owner's general resume, not tied to any employer or job description. It is
judged on one clear story, claims that can be measured, and a demo that works every time.

## 1. Product
**Lumen is an accounts-payable copilot for small finance teams. It reads invoices, validates them against
purchase orders and vendor history, flags exceptions for human review, and answers spend questions with cited
evidence.**

## 2. User and the 90-second demo
User: an AP clerk or finance lead at a small company.

1. Upload 5 invoices, one of them bad.
2. Each is extracted with field-level confidence.
3. The bad one is flagged and lands in a review queue.
4. Ask: *"Why was INV-1042 flagged, and what did we pay this vendor last quarter?"*
5. The answer cites its sources and shows its tool steps (which tools ran, the validated SQL, the retrieved passages).

## 3. What RAG is for
Transactions stay in SQL. RAG covers **unstructured text only**: invoice OCR full text, line-item
descriptions, notes, uploaded POs, vendor contracts, and payment-terms and policy PDFs. The agent has to choose
between `run_sql` and `search_documents`, and that choice is measured.

## 4. Autonomy boundary
The agent is **read-only, plus "flag / propose"**. A human approves anything that changes state (approve, mark
paid, edit, delete). Proposals go to the review queue, never straight to the data.

## 5. Success metrics
Targets stay placeholders until the EVAL-03 baseline is measured; every reported number names the model that
produced it.

| Area | Metric |
|---|---|
| Text-to-SQL | Execution accuracy (result sets compared, not SQL text); SQL **fallback rate**, where a fallback counts as a failure |
| Extraction | Field-level F1 |
| Retrieval | recall@5, nDCG@10 (with an ablation: dense → + BM25/RRF → + rerank) |
| Generation | Answer faithfulness (judged by a different, stronger model than the one under test) |
| Agent | Tool-selection accuracy (`run_sql` vs `search_documents`, etc.); abstention accuracy on unanswerable questions |
| Safety | Tenant-leak count: **must be 0**; prompt injection inside documents is tested |
| Ops | p95 latency; cost per question |

## 6. Data
Everything used for the demo and evals is **synthetic**; no real invoices go to any third-party API. A
seeded Python generator (Faker plus PIL/reportlab) renders invoices as PNG/PDF from ground-truth JSON, so labels
are exact by construction. It plants deliberate faults: total mismatch, duplicate, unknown vendor, bad date,
and injected instructions. The same generator writes the POs, contracts and policies for the corpus. The
owner spot-checks about 30%. Target: at least 20 labelled invoices plus the eval question sets in EVAL-02.

## 7. Deploy target
**Render free + Vercel, with a light stack.**
- Local `fastembed` embeddings (`bge-small-en-v1.5`), FlashRank reranking, and 1 gunicorn worker. Memory gets
  measured in LLM-02/RAG-05 before we commit to it.
- The heavy reranker (`bge-reranker-v2-m3`) runs locally, only for the ablation, and the README says so.
- Postgres with pgvector (pgvector verified in local pgserver). Render's free database expires after 30 days, so
  production uses paid Basic or Supabase Postgres with RLS on every app table.

## 8. Constraints that hold throughout
- **LLM providers:** Groq (free tier) for evals, CI and the demo; local Ollama (`qwen2.5:3b`, `qwen3:4b`) for
  plumbing only, never for reported numbers; OpenRouter as a fallback.
- **Reproducible evals:** record/replay cache, temperature 0. Tests never make live LLM calls.
- **Keep:** the sqlglot validation and per-user scoping, `LLMError` typing with reasoning off by default, JWT auth,
  and the mocked-LLM test suite.
- **Honesty:** RAG is disabled in production today (`ENABLE_CHROMA=false`). No doc or resume line claims RAG in
  production until RAG-09 ships.

## 9. Non-goals
- Payments, ERP integrations, and multi-currency FX conversion (currency is *stored*; amounts are not converted).
- Gmail OAuth and email polling (proposed cut, roadmap 6b #9).
- Theme, dark mode and a11y polish beyond the core path.
- Anything from `v2/intelligence-agent`.

## 10. Next
Owner approves this page → Phase 1 specs in roadmap order (SPEC-EVAL, SPEC-LLM, SPEC-RAG, SPEC-AGENT,
SPEC-EXTRACT, SPEC-UX). No specs or code before the owner says "go".
