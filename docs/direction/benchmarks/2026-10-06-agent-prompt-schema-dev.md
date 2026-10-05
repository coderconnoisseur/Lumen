# 2026-10-06: agent prompt with a compact schema (dev split)

The `agent` suite on the 28 dev cases of `agent.jsonl`, Groq tier (`openai/gpt-oss-120b` for every call), recorded
live and replayed offline from `backend/evals/cassettes/groq/agent.jsonl` with identical numbers.

**Change:** the system prompt now lists the two queryable tables and their columns (generated from the models,
like `get_schema`; `user_id` left out because the server scopes every query). v2 also routes purchase-order
numbers to `search_documents`, duplicate charges to `get_anomalies`, and tells the agent to try the other likely
tool before giving up.

| Metric | Before (2026-10-04) | v1: schema only | v2: schema + routing lines |
|---|---|---|---|
| Tool-selection accuracy | 22/24 (0.74-0.98) | 18/24 (0.55-0.88) | **21/24** (0.69-0.96) |
| Abstention accuracy (as scored) | 28/28 (0.88-1.00) | 26/28 (0.77-0.98) | 26/28 (0.77-0.98) |
| Whole case right | 26/28 | 22/28 | 23/28 |
| LLM calls (28 questions) | 73 (2.6 per question) | 54 (1.9) | **54 (1.9)** |
| Tokens per question | 2,961 | 2,121 | **2,233** (-25%) |
| Latency p50 / p95 (recorded) | 2.0 s / 5.5 s | 1.6 s / 3.3 s | 2.1 s / **3.3 s** |
| `get_schema` calls | 7 | 0 | **0** |
| SQL rejected or failed (guessed columns/tables) | 8 | - | **0** |
| Questions answered with one tool | 17 | - | **22** |

## What v1 broke and v2 fixed
With the columns in view, v1 sent "PO-…" numbers to `get_invoice` (it saw an `invoice_number` column), found
nothing and gave up; and it answered "charged twice?" with its own GROUP BY instead of `get_anomalies`. v2's routing
lines brought both purchase-order questions back to the documents and the duplicate question back to anomalies.

## The five v2 misses, read by hand
- **agent-003, -009, -010** (FreshMart total, average fuel bill, PetPals total): answered from `lookup_vendors`,
  which already returns each vendor's total and transaction count; the label expects `run_sql`. The fuel answer
  (₹98,078.84 / 36 = ₹2,724.41) is computed from that data. 003 and 010 were misses before too.
- **agent-026** ("charged twice?"): right tool; the answer "I couldn't find any duplicate-charge anomalies" is a
  grounded *no*, but the abstention regex reads "couldn't find" as a refusal.
- **agent-040** ("Who will win the next general election?"): the agent declined ("I don't have information to
  answer that"), but that phrasing isn't in the abstention regex, so it's scored as an answer.

So by hand every v2 case is either right or a label/scorer artefact; as scored, routing is one case lower than
before (inside the CI) and abstention two lower. Fixing the scorer is a metric change and waits for the owner.

## Cost of the experiment
Two recordings, 108 Groq calls, ~120K tokens on the free tier (200K/day per model); $0.
