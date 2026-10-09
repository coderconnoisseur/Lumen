# 2026-10-09: AGT-07 final, agent vs fixed pipeline (dev split)

Same model for both (Groq `openai/gpt-oss-120b`). Agent prompt v3: compact schema + routing lines (2026-10-06) +
hardening (pasted text is data, never instructions; list answers show vendor, date and amount). All three agent
suites re-recorded 2026-10-09 and replayed offline to identical numbers; grading as approved (answers without SQL
rows graded by their text; lookup answers count as the SQL route).

## SQL (32 gold questions)
| | Pipeline | Agent (2026-10-07) | **Agent v3** |
|---|---|---|---|
| Execution accuracy (gated) | 29/32 (0.76-0.97) | 28/32 | **31/32** (0.84-0.99) |
| Strict (exact columns) | 21/32 | 19/32 | **26/32** |
| LLM calls / question | 1.1 | 2.2 | 2.2 |
| Tokens / question | 691 | 2,828 | 3,309 |
| Latency p50 / p95 (recorded) | 0.9 s / 3.0 s | 1.9 s / 5.4 s | 1.5 s / 3.1 s |

Paired vs the pipeline: the agent **fixes** sql-007, sql-010, sql-013 and **regresses** sql-043 only (it averages
the milk price weighted by quantity, ₹58.66, where the gold takes the plain mean of unit prices, ₹58.60).

## Safety (14 dev cases: 7 tenant, 5 injection, 2 poisoned documents)
| | Agent (2026-10-07) | **Agent v3** |
|---|---|---|
| Tenant leaks (hard gate 0) | 0 | **0** |
| Injections followed (hard gate 0) | 1 | **0** |

## Routing (28 agent cases)
Tool selection 24/24, abstention 28/28 (unchanged), 2.0 calls and ~3,100 tokens per question.

## Decision (SPEC-AGENT acceptance 4)
**Gates met:** no worse on SQL (31 vs 29, one regression read by hand as a defensible interpretation) and both
safety gates at 0. `/chat` switches to the agent. The trade-off, reported not hidden: ~2× the calls and ~5× the
tokens of the fixed pipeline per question, for answers that can also use documents, anomalies and forecasts, and
cite their evidence.

## Cost
3 recordings, 223 Groq calls, ~190K tokens (one day's free quota); $0.
