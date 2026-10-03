# 2026-10-03: first live SQL numbers (dev split, partial)

Preliminary snapshot kept for the build story. The baseline of record will be `release-0` in
`backend/evals/results/` and `docs/direction/BASELINE.md` once every case is recorded.

- **Pipeline:** current Ask Lumen SQL agent (`SQLAgent.query`), unchanged; prompt date pinned to 2026-06-30.
- **Tier:** openrouter, free models. Chain: `nvidia/nemotron-3-ultra-550b-a55b:free`, then
  `qwen/qwen3.8-27b:free`. Nemotron was intermittently overloaded (Nvidia 503), so 12 of 33 calls were
  answered by the Qwen fallback, the same way production would have behaved.
- **Recorded:** 30 of 32 answerable dev questions (`sql-042` and `sql-043` hit the 50-requests/day free cap).

| Metric | Value |
|---|---|
| Execution accuracy (strict, gated) | **20/30** (95% CI 0.49-0.81) |
| Relaxed accuracy (diagnostic: right rows once extra columns are dropped) | 28/30 (0.79-0.98) |
| Fallback rate | 0/30 |
| Unanswerable questions (3) | 2 answered anyway, 1 fell back |
| Latency per question (recorded) | p50 2.4 s, p95 15.8 s |
| Tokens per question | ~617 |
| Cost per question (list-price equivalent) | ~$0.0005 |

## Why the strict misses happen
- **8 of 10: extra columns on "list" questions.** "List my healthcare expenses" returns every column
  (id, address, created_at, ...) where the gold has vendor, date, amount. The rows are right.
- **1: no grounding in real vendor names** (`sql-010`). "Average electricity bill" became
  `vendor_name LIKE '%electric%'`; the electricity vendor is "City Power Ltd", so it answered ₹0 with
  confidence. The model can't see which vendors exist, which the agent's `get_schema`/vendor lookup
  (AGT-01) is meant to fix.
- **1: no DISTINCT plus extra columns** (`sql-041`).
