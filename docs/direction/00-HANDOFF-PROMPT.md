# Handoff: direction change for the agent working on Lumen

Written 2026-10-03. Audience: the coding agent currently building on Lumen. Owner: Nishant.

## What the owner should do

Paste the block under "Prompt to paste" into the agent's conversation. It tells the agent to stop starting new
work, report its state, and read the new direction. Nothing in it asks the agent to delete or revert anything.

---

## Prompt to paste

```
STOP and read this before doing anything else. The plan you were following has changed.

An external audit reviewed PLAN.md, TODO.md, the .superpowers/plans/*, the git log and backend/ai/*. Verdict:
the work so far is solid production hardening, but the project is changing direction. We are no longer
polishing Lumen as a SaaS. We are turning it into an AI-engineering showcase: evals, tool-calling agent,
robust hybrid RAG (BM25 + dense + RRF + cross-encoder rerank), structured extraction with human review, tracing.

1. Do NOT start any new task from PLAN.md, TODO.md, or a .superpowers plan. That includes Postgres dialect
   fixes beyond what is already in flight, Gmail OAuth, theme/dark-mode work, dead links, a11y polish,
   and doc rewrites.

2. Finish only the single task you are in the middle of, if it is small and leaves the tree green.
   Otherwise stop where you are. Do not push. Do not merge. Do not delete branches.

3. Reply with a status report and nothing else yet:
   - current branch and worktree path
   - `git status --short` and the last 5 commits
   - what you were in the middle of, and whether it is safe to commit as-is, needs finishing, or should be set aside
   - test result (run from backend/: env -u OPENROUTER_API_KEY python -m pytest -q) and the count
   - anything you learned about the code that is not in the docs (surprising behaviour, known bugs, fragile areas)

4. Then read, in this order:
   - docs/direction/01-ROADMAP.md  (the new direction, phases, and ordered actionables)
   - backend/ai/sql_agent.py, backend/ai/hybrid_query_engine.py, backend/ai/rag_system.py, backend/utils/llm.py
   After reading, do not code.

5. Branch decision: we continue the INVOICE lineage of Lumen (the refactor / fix/* branches), not
   v2/intelligence-agent. Do not rename or move the branch you are on yet. Once the owner confirms, new work
   goes on a new branch cut from the branch in your status report, named feat/ai-eng-direction.

6. After your status report and reading, start Phase 0 with the owner, using the superpowers:brainstorming skill:
   - Ask the questions in section 1.2 of the roadmap ONE AT A TIME, offering the proposed default as the
     first option each time. Skip nothing, but accept "use the default".
   - This is a resume project for the owner, not tied to any employer or job description.
   - When all seven are answered, write docs/direction/IDEA.md (one page) and show it for approval.
   - Then STOP. Do not write specs or code until the owner says "go" for Phase 1.

Facts you must not get wrong:
- Phase order is: idea clarity -> specs -> module-level TODO -> build. We are at the start of Phase 0.
- Keep, do not rewrite: the sqlglot validation and per-user scoping in ai/sql_agent.py, the LLMError typing and
  reasoning-off default in utils/llm.py, JWT auth, the mocked-LLM test suite.
- RAG is currently disabled in production (ENABLE_CHROMA=false in render.yaml). Do not claim otherwise in any doc.
- Never make live LLM calls from tests. The free OpenRouter key allows only ~50 requests/day.
- Keep following the commit and style conventions already used in this repo's .superpowers plans.
- There is a separate branch, v2/intelligence-agent (a portfolio/news-intelligence product also named Lumen,
  last touched 2026-07-24). It is unaudited and out of scope. Do not merge from it or build on it.
- The next LLM providers are Groq (free, OpenAI-compatible) and local Ollama (qwen2.5:3b, qwen3:4b installed).
  Small local models are for plumbing only; do not trust them for text-to-SQL or tool-calling accuracy.

Acknowledge with the status report. Do not start anything else.
```

---

## Context for a human reader

### What changed and why
| Before | Now |
|---|---|
| Goal: production-ready invoice SaaS | Goal: credible, measurable AI-engineering project for the owner's general resume (not tied to any one employer or JD) |
| Roadmap: auth, security, DB, polish, deploy | Roadmap: evals, tool-calling agent, hybrid RAG with rerank, extraction + review queue, tracing |
| LLM: OpenRouter free models | Tiers: Ollama (dev), Groq (evals/demo), OpenRouter (fallback) |
| RAG: Chroma dense only, off in prod | BM25 + dense + RRF + cross-encoder, pgvector, on in prod |

### Branch map (as of 2026-10-03)
| Branch / worktree | Status |
|---|---|
| `fix/ai-analytics-postgres` (this worktree, `magical-wu-52d692`) | Latest work: Postgres-safe analytics, Ask Lumen latency, upload fixes. 89 commits, last 2026-09-25 |
| `refactor` (main checkout) | Integration branch the fix branches are cut from |
| `fix/ask-lumen-llm-errors` (worktree `silly-chebyshev-4fe09f`) | Related fix branch |
| `v2/intelligence-agent` | Different product (portfolio news intelligence), 2026-07-24, out of scope |
| `backup/auth-04-05-work`, `backup/auth-06-work` | Local backups, not for merging |

### What the agent must not undo
The SQL isolation tests (`backend/tests/test_sql_isolation.py`), the LLM tests (`test_llm.py`), and CI must stay
green through every change.

### After the agent replies
Owner reviews the status report, decides what to land or park (Roadmap section 6, item 2), then starts Phase 0.
