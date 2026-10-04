# SPEC-AGENT: a bounded tool-calling agent for Ask Lumen

Status: **DRAFT for owner review** (one-pager). Covers roadmap **AGT-01 … AGT-07** and builder finding 6b
**#13**. Builds on SPEC-LLM (client, deadline, cassettes), SPEC-RAG (`search_documents`) and the SQL
guardrails.

## Goal
Replace the fixed chat pipeline (question → SQL → answer) with an agent that picks its own tools, so it can
answer "why was INV-1042 flagged and what did we pay this vendor last quarter?". Answers cite their evidence
and show their tool steps. The agent reads and proposes; it never changes data itself.

## Why (measured, not assumed)
- The SQL baseline's one confidently wrong answer came from **guessing a vendor name** ("electric" → ₹0). An
  agent that can look up the user's real vendors and schema first fixes that class of error.
- Document questions are invisible to chat today; they need `search_documents`, and choosing between SQL and
  documents is exactly the skill IDEA.md section 5 measures (tool-selection accuracy).

## Design
| Part | Choice | Why |
|---|---|---|
| **Loop** | LangGraph `StateGraph`: `agent` node (LLM with tools) ⇄ `tools` node, max **6 tool calls** per question, tool errors fed back to the model (max 2 retries per tool), the 100 s request deadline over everything. | Explicit, testable states and a hard step bound; IDEA.md picked LangGraph for the loop and the approval pause. The LLM call inside the node is our own client, so failover, cassettes and the deadline still apply. |
| **Tools** (typed with Pydantic, AGT-01) | `get_schema` (generated from the models, fixing 6b #13), `lookup_vendors(hint)` (the user's real vendor names, fuzzy-matched), `run_sql(sql)` (the existing sqlglot validation + per-user scoping + read-only), `search_documents(query)` (SPEC-RAG hybrid + rerank), `get_invoice(number)`, `get_anomalies()`, `forecast(months)`, `propose_action(...)` | Each wraps code that already exists and is tested, so the agent adds routing, not new attack surface. `lookup_vendors` targets the measured failure. |
| **Tenant isolation** | The user id is bound into every tool server-side; the model never passes or sees it. | Same rule as SQL and RAG: isolation in code, never in the prompt. |
| **Proposals (autonomy boundary)** | `propose_action` writes a typed proposal `{type, target, payload, risk: low|medium|high, reason, evidence}` to a `proposals` table with status `pending`, and the run ends with "proposal filed". Approve/reject is a separate API call by a human; every transition goes to an audit log. | Simpler and more robust than keeping a paused graph alive across HTTP requests (no checkpoint store needed). Auto-applying low-risk proposals later is a policy change. |
| **Answer contract** | Final answer cites document chunk ids `[doc#s02]` and refers to SQL results; the response returns `steps: [{tool, args, summary, latency_ms}]` and the validated SQL, for the UI's "show your work" panel. | Evidence-first answers are what make an AI answer checkable. |
| **Rollout** | `POST /api/agent/ask` (FastAPI) first. `/chat` switches to the agent behind `LUMEN_CHAT_ENGINE=agent` only after AGT-07 shows it is at least as good as the baseline on SQL accuracy and passes both safety gates. | Never ship a regression to the main path because "agents are better". |

## Evaluation (AGT-07)
- **Agent suite** (`agent.jsonl`, 40 cases): tool-selection accuracy (first tool other than `get_schema` /
  `lookup_vendors`) and abstention accuracy.
- **SQL suite through the agent:** execution accuracy end to end, compared case by case with the baseline.
- **Safety suite through the agent:** tenant leaks = 0 and injections followed = 0 (hard gates), including the
  RAG-08 poisoned documents.
- **Ops:** LLM calls per question, p95 latency, cost per question. An agent typically uses 2–4 calls per question
  versus today's 2, so the trade-off is reported, not hidden.

## Acceptance criteria
1. Every tool has a unit test with the user id bound server-side; no tool accepts a user id argument.
2. The loop stops at 6 tool calls or the deadline, and returns a partial answer saying so.
3. `propose_action` never changes data; approving a proposal is a separate authenticated call; both are audit-logged.
4. AGT-07 report: agent vs baseline per suite with counts, CIs and paired regressions; `/chat` switches only if
   it is no worse on SQL and passes both gates.

## Open questions for the owner
1. **Groq free key (strongly recommended):** the agent needs 2–4 LLM calls per question, so recording its evals on
   OpenRouter's 50 requests/day takes about a week. Groq's free tier allows far more requests per day and is
   already the planned evals tier (IDEA.md section 9). Getting a key is a free sign-up at console.groq.com; you'd
   put it in `backend/.env` as `GROQ_API_KEY` yourself. OK to plan around it?
2. **LangGraph:** keep it (IDEA.md's choice; useful structure; adds `langgraph` + `langchain-core`, memory to be
   measured), or hand-roll the ~100-line loop (fewer dependencies, shows the mechanics)? Recommendation: keep
   LangGraph, use our own LLM client inside it.
3. **Memory (AGT-05)** stays on the cut line (last to build, first to cut). OK?
