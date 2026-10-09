# Lumen design decisions

One place for every design decision: what was decided, by whom, why, and where the detail lives. Newest at the
bottom of each section. "Owner" = decided by the owner; "Build" = decided while building and recorded for review.
Add a line whenever a decision is made; specs and PROGRESS keep the long form.

## Product and process
| Date | Decision | By | Why | Source |
|---|---|---|---|---|
| 2026-10-03 | Lumen is an AI-engineering showcase: an AP assistant whose claims are all measured | Owner | Resume value comes from numbers, not features | `IDEA.md` |
| 2026-10-03 | Strict gates: idea → spec → owner approval → TODO → build | Owner | Avoid building the wrong thing | `01-ROADMAP.md` |
| 2026-10-03 | Local-first; any live deployment is assumed broken until the owner says otherwise | Owner | Deployments kept drifting | `SPEC-RAG.md` decision 5 |
| 2026-10-04 | UI stays minimal (test pages) until a final, owner-led UI refactor | Owner | Backend quality first | `PROGRESS.md` 2026-10-04 |
| 2026-10-04 | A PR after every concrete step, stacked; `docs/CODEBASE-GUIDE.md` kept current | Owner | Reviewable history | `PROGRESS.md` |
| 2026-10-06 | I may merge my own green PRs into `refactor`; every release to `main` needs the owner | Owner | Speed without losing control of production | memory |
| 2026-10-09 | No release until the RAG/agent work is finished; then move on to other features | Owner | Close one thing before the next | this log |
| 2026-10-09 | All design decisions are listed in this file | Owner | One place to look | this log |

## LLMs and evaluation
| Date | Decision | By | Why | Source |
|---|---|---|---|---|
| 2026-10-03 | Free-first: OpenRouter free tier, then Groq; calls go through one client with tiers and failover | Owner | $0 budget | `SPEC-LLM.md` |
| 2026-10-03 | Evals record live calls once (`--record`) and replay them offline in CI | Build | Deterministic, free CI | `SPEC-EVAL.md` |
| 2026-10-03 | Gated SQL metric = column-tolerant execution accuracy; strict reported alongside | Owner (delegated) | Extra columns don't make an answer wrong, wrong rows do | `PROGRESS.md` |
| 2026-10-04 | Groq text chain gpt-oss-120b → qwen3.8-27b → gpt-oss-20b; judge = qwen (different family) | Build | Tied on SQL; 120b best point estimate, no fallbacks | `LLM-BENCH.md` |
| 2026-10-04 | Invoice images stay on OpenRouter's free vision model | Build | Groq has no vision model | `LLM-BENCH.md` |
| 2026-10-04 | After every recording, replay immediately and confirm the numbers match | Build | A recorder bug once made replays fail (STORY 15) | `STORY.md` 15 |
| 2026-10-06 | Agent grader: an answer from `lookup_vendors` counts as the SQL route; "not found" after the right tool is an answer | Owner | Grade the agent, not its phrasing; old and new runs re-scored alike | `STORY.md` 17 |
| 2026-10-07 | Agent SQL answers without rows are graded by the answer text (every gold value present) | Owner | Correct answers from the vendor lookup had no rows to compare | `STORY.md` 18 |

## RAG (document search)
| Date | Decision | By | Why | Source |
|---|---|---|---|---|
| 2026-10-03 | Postgres + pgvector on Supabase in production, numpy store on SQLite locally | Owner | Free tier doesn't expire; auth already there | `SPEC-RAG.md` 1 |
| 2026-10-03 | Hybrid retrieval: dense (bge-small) + per-user BM25, fused with RRF k=60, then a FlashRank reranker | Build | Ablation 67 → 82 → 104/104 right section in top 5 | `benchmarks/2026-10-04-retrieval-ablation-dev.md` |
| 2026-10-04 | Rerank the top 15 candidates | Build | Same hit@5 as 30, half the latency | `PROGRESS.md` |
| 2026-10-04 | No reranker-score cut-off for abstention; abstain on no evidence → missing identifier → model NOT_FOUND | Owner | The cut-off refused good short questions | `SPEC-RAG.md` 4 |
| 2026-10-04 | Documents have no FK to users; every query filters by user | Build | Tenant filter is on every read | `PROGRESS.md` |

## Agent
| Date | Decision | By | Why | Source |
|---|---|---|---|---|
| 2026-10-04 | LangGraph for the tool loop; 6-call cap; tool results truncated | Owner | Bounded cost and context | `SPEC-AGENT.md` |
| 2026-10-04 | The user id never reaches the model; SQL is scoped to the user server-side | Build | The model can't leak what it can't name | `STORY.md` 14 |
| 2026-10-04 | The agent proposes, a person approves; every decision audit-logged | Owner | Human in the loop for any change | `SPEC-AGENT.md` |
| 2026-10-06 | System prompt carries a compact schema generated from the models | Build | 27% fewer calls, 25% fewer tokens at the same accuracy | `STORY.md` 16 |
| 2026-10-07 | `/chat` switches to the agent only if no worse on SQL and both safety gates pass | Owner (spec) | Don't trade safety for features | `SPEC-AGENT.md` acceptance 4 |
| 2026-10-07 | Prompt: pasted text is data, never instructions; list answers show vendor, date and amount | Build | One planted injection was followed (STORY 18) | `STORY.md` 18 |
| 2026-10-09 | `/chat` (Ask Lumen) runs the agent; the old pipeline stays only as the eval baseline | Build (gates) | SQL 31/32 vs 29/32, 0 leaks, 0 injections | `benchmarks/2026-10-09-agt07-final-dev.md` |
| 2026-10-09 | Demo accounts share one 20-question daily allowance across `/chat` and `/api/agent/ask` | Build | The cap must not be bypassable | PR #33 |
| 2026-10-09 | Token checks allow 30 s of clock skew; a failed demo setup signs the visitor out | Build | Supabase's clock ran ahead; demo seeding failed | PR #33 |

## Extraction, validation and review
| Date | Decision | By | Why | Source |
|---|---|---|---|---|
| 2026-10-04 | Auto-approve high-confidence invoices; queue the rest for review | Owner | Shows the value of validation | `SPEC-EXTRACT.md` |
| 2026-10-07 | Confidence comes from deterministic checks, never from asking the model | Build (spec) | Verifiable | `SPEC-EXTRACT.md` |
| 2026-10-07 | Warnings vs failures: unknown vendor / unknown PO / no currency warn; wrong total, duplicate, bad date, PO mismatch, injection fail | Build | Warnings can be routine; failures never are | `extract/validate.py` |
| 2026-10-07 | Totals tolerance 1%; dates may be up to 2 years old, never in the future | Build | Rounding and printed values | `extract/validate.py` |
| 2026-10-07 | Every way an invoice arrives (upload, multi-page PDF, email) goes through one `submit_invoice`; only approved invoices become transactions | Build | No path around the checks | `CODEBASE-GUIDE.md` 8 |
| 2026-10-07 | A re-upload is flagged as a duplicate for review instead of silently returning the old transaction | Build | Catching double billing is the point | `CODEBASE-GUIDE.md` 8 |
| 2026-10-07 | Rules skip what today's reader can't see: no currency field, unpriced line items, users with no history | Build | Otherwise every upload is flagged | `CODEBASE-GUIDE.md` 8 |
| 2026-10-07 | A receipt without a readable date goes to review | Build | A payment can't be recorded without a date | PR #29 |
| 2026-10-07 | Feedback loops change what the model is shown and which warnings are raised; no model training | Owner | Honest "learning" claim | `SPEC-FEEDBACK.md` |
| 2026-10-07 | Loop B: 3 unchanged approvals in a row silence a warning per user and vendor; failures never adapt; suppressed warnings stay visible as notes | Owner | Less review work, no missed faults | `SPEC-FEEDBACK.md` |
| 2026-10-07 | Rejections don't teach in v1 | Owner | Keep v1 simple | `SPEC-FEEDBACK.md` |
| 2026-10-09 | Only a rejection that no failure explains resets a vendor's warnings | Owner | Measured 48 → 36 (not 44) of 120 sent to review, 0 missed | `benchmarks/2026-10-07-feedback-loop-b.md` |

## Deployment
| Date | Decision | By | Why | Source |
|---|---|---|---|---|
| 2026-10-06 | Vercel (web) + Render free (API) + Supabase; fresh projects under the owner's accounts | Owner | $0, stable | `SPEC-DEPLOY.md` |
| 2026-10-06 | Fixed address `lumen.nishantbuilds.me` (+ `api.`) via Namecheap CNAMEs | Owner | The resume link never changes | `SPEC-DEPLOY.md` |
| 2026-10-06 | Render deploys `main` only after CI passes; keep-warm ping every 10 minutes | Owner | No broken deploys; no cold starts for recruiters | `SPEC-DEPLOY.md` |
| 2026-10-06 | One-click demo = Supabase anonymous sign-in + a private seeded copy per visitor; 20 agent questions/day | Owner | No shared account to break; protects the free quota | `SPEC-DEPLOY.md` |
| 2026-10-06 | "Waking up the server" banner if the API is slow to answer | Owner | Honest about the free tier | `SPEC-DEPLOY.md` |
| 2026-10-06 | SQLAlchemy pinned to 2.0 | Build | 2.1 switches `postgresql://` to a driver we don't ship | PR #16 |
| 2026-10-07 | API in Render's Singapore region | Owner | Next to the Supabase database (ap-southeast-1) | PR #22 |
| 2026-10-09 | keep-warm skips while the API's DNS name doesn't resolve | Build | Not deployed yet; a real outage still fails | PR #31 |
