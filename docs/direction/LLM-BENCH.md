# LLM-02 mini-bench

Which model each tier uses is decided here, from data. `python -m evals.bench` runs an eval suite once per
candidate, each alone in the chain (no fallback), and rewrites the tables between the markers. Replays are
offline from `backend/evals/cassettes/<tier>/`. Free-tier limits at the time: Groq 30 requests/min, 1,000/day,
8K tokens/min per model; OpenRouter free models ~50 requests/day.

## Decisions (2026-10-04)
- **Groq text chain:** `openai/gpt-oss-120b` → `qwen/qwen3.8-27b` → `openai/gpt-oss-20b`. On SQL the three are
  statistically tied (overlapping 95% intervals); gpt-oss-120b has the best point estimate and no fallbacks.
  Qwen is the fastest (p95 0.6 s) and the first fallback. To be re-checked on tool calling once the agent suite
  exists (SPEC-AGENT), since that's where models differ most.
- **Groq judge:** `qwen/qwen3.8-27b`: a different model family from the text model (judge rule).
- **Groq has no vision model** on this account, so invoice extraction stays on OpenRouter's vision chain
  (`google/gemma-4-31b-it:free`), as SPEC-EVAL planned for this case.
- **Reasoning switches verified:** `reasoning_effort: low` for gpt-oss and `none` for qwen3 were accepted (no
  errors in 96 calls). Previously unverified.
- **Comparison with OpenRouter** (same suite, free `nvidia/nemotron-3-ultra-550b-a55b`): 29/32 right rows, p50
  2.9 s / p95 8.9 s. Same accuracy, Groq 3-10× faster.

## groq: sql suite (dev split)

<!-- bench:groq-sql:start -->
| Model | Execution accuracy (gated) | Strict | Fallbacks | Errors / misses | p50 / p95 latency | Tokens per question |
|---|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | 29/32 (76%-97%) | 21/32 (48%-80%) | 0/32 (0%-11%) | 0 | 0.9 s / 3.0 s | 691.4 |
| `qwen/qwen3.8-27b` | 28/32 (72%-95%) | 20/32 (45%-77%) | 1/32 (1%-16%) | 0 | 0.4 s / 0.6 s | 632.5 |
| `openai/gpt-oss-20b` | 28/32 (72%-95%) | 21/32 (48%-80%) | 1/32 (1%-16%) | 0 | 0.6 s / 0.8 s | 672.7 |
<!-- bench:groq-sql:end -->
