# 2026-10-04: agent routing (dev split)

The `agent` suite (`backend/evals/suites/agent.py`) on the 28 dev cases of `agent.jsonl`, Groq tier
(`openai/gpt-oss-120b`, all 73 calls), replayed offline from `backend/evals/cassettes/groq/agent.jsonl`.

| Metric | Value |
|---|---|
| Tool-selection accuracy (first tool other than get_schema / lookup_vendors) | **22/24** (95% CI 0.74-0.98) |
| Abstention accuracy (declines the 4 out-of-scope questions, answers the rest) | **28/28** (0.88-1.00) |
| Whole case right | 26/28 (0.77-0.98) |
| LLM calls per question | 2.6 (73 calls / 28 questions) |
| Tokens per question | ~2,960 |
| Latency per question (recorded) | p50 2.0 s, p95 5.5 s |

Tool usage across the 28 questions: run_sql 15, search_documents 9, get_schema 7, lookup_vendors 6, get_anomalies 3,
forecast 3, get_invoice 2. 17 questions needed one tool; 4 needed four.

## The two misses
Both "total spend at FreshMart" and "PetPals Clinic visits in total" were answered from `lookup_vendors`, which
already returns each vendor's total spent, so the agent never called `run_sql`. The label expected `run_sql`; the
route is arguably fine (cheaper, same data). Reported as measured.

## Observations for the next iteration
- The agent sometimes guesses column names (`amount`, `vendor`, `tax_type`) before calling `get_schema`; the error
  goes back to it and it corrects itself, but each guess costs a call. Candidate fix: a compact schema in the system
  prompt, measured before/after.
- Comparison with the fixed pipeline (SQL suite, same model): the pipeline uses exactly 1-2 calls; the agent uses 2.6
  on average but can also answer document, anomaly and forecast questions the pipeline can't.
