# SPEC-AGENT-TOOLS: Ask Lumen sees the whole app

Status: **APPROVED in principle (owner, 2026-10-14): views + compute tools**, with the vague-question design below (owner, 2026-10-14: the chatbot must know everything about the user's finances that
the app knows; no eval re-recording until the tool set is settled).

## Where we are
Eight tools: `get_schema`, `lookup_vendors`, `run_sql` (transactions + line items only), `search_documents`
(hybrid RAG), `get_invoice`, `get_anomalies`, `forecast` (a linear trend, not the app's forecasting agent),
`propose_action`. The agent can't see: the profile and goals beyond the prompt block, the review queue, insights and
reminders the app shows, the risk/health score, recurring patterns, documents list, email-connection status, and
anything the next features add (statements, budgets, subscriptions, notifications).

## Principle
**Data the app stores → one SQL tool over curated read-only views. Things the app computes → one tool each.
Changes → proposals the user approves.** Every feature that ships adds a view or a tool in the same PR, so the agent
never falls behind the app.

## Proposed catalogue
| Kind | Tool | Covers |
|---|---|---|
| Read (SQL) | `run_sql` over views: `transactions` (+ `source`: invoice/email/statement), `transaction_items`, `review_items` (pending/flagged), `insights`, `reminders`, `recurring_charges`, `documents`, and later `budgets`, `subscriptions`, `notifications` | anything stored; per-user scoping stays server-side (existing CTE shadowing + sqlglot checks) |
| Read | `get_overview()` | a precomputed snapshot for broad questions: this month vs last, spend vs budget, top categories and their trend, recurring charges and upcoming bills, health-score factors, open insights |
| Read | `get_profile` | currency, budget, income, use case, goals (also in the prompt; the tool lets it be cited) |
| Read | `search_documents` | contracts, policies, uploaded PDFs (hybrid RAG, unchanged) |
| Compute | `forecast(horizon)` | the app's forecasting model (the time-series spec replaces the linear trend) |
| Compute | `health_score()` | the risk/health score and its factors (`ai/risk_assessment.py`) |
| Compute | `get_anomalies()` | unusual or duplicate charges (existing) |
| Compute | `exchange_rate(base, quote, date?)` | ECB rates (SPEC-CHAT-TOOLS) |
| Context | `attached_invoice` | an invoice uploaded in this chat (SPEC-CHAT-TOOLS) |
| Act | `propose_action` + types `save_invoice`, `update_category`, `flag_invoice`, `mark_paid`, later `set_budget`, `cancel_subscription_reminder` | nothing changes without approval |

Tool count stays around 10 because data goes through one SQL tool; strong models (guaranteed by SPEC-BYOK) handle
that well. `get_schema` documents every view, with one example question per view.

## Vague questions (owner's concern: not every finance question is a SQL query)
- Broad questions ("am I doing okay?", "why am I short at month end?") start from `get_overview`, then drill down with
  SQL or a compute tool only if needed; the prompt tells the agent to gather 2-3 signals before answering a broad
  question instead of guessing one query.
- **General finance knowledge is allowed and labelled** ("emergency fund", "is a 30% savings rate good?"): answered
  from the model's own knowledge, marked as general guidance, kept separate from the user's numbers. Today's prompt
  refuses these; that changes.
- SQL, overview, compute tools and RAG are independent paths; none depends on another.

## Privacy (owner)
Ask Lumen sees parsed transactions only, never email content.

## RAG: do we need more (reranking, BM25, HyDE)?
- **Already in production:** BM25 + dense embeddings fused with RRF, then a cross-encoder reranker over the top 15,
  abstention when no passage covers the question, citations. Ablation on the dev set: hit@5 67 (dense) → 82 (hybrid)
  → 100/104 (hybrid + rerank).
- **HyDE / query rewriting:** not now. It helps vague questions over large, varied corpora; ours are a user's own
  short documents with exact terms (vendor names, PO numbers, clause names) that BM25 already nails, and it adds an
  LLM call per search. Revisit if eval misses are paraphrase failures.
- **Where "knowing everything" really comes from:** structured data via views + compute tools above, not RAG. RAG
  stays for unstructured documents.

## Evals (later, once the catalogue is settled)
One re-record covering: a question per view, a question per compute tool, an attached-invoice question, a save
proposal, an exchange-rate question, multi-tool questions (e.g. "can I afford X given my forecast and budget?").

