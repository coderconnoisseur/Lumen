# Lumen

**An AI money advisor that reads your bills, answers questions about your spending, and keeps finding ways to save.**

Live: **[lumen.nishantbuilds.me](https://lumen.nishantbuilds.me)** · try the one-click demo (no sign-up).

## What it does
- **Reads invoices and receipts:** one vision call extracts vendor, date, amounts, line items and currency; checks
  (duplicates, totals, PO matching) flag anything doubtful into a review queue before it becomes a transaction.
- **Ask Lumen:** a tool-calling agent that answers questions over your own data (SQL), your documents (hybrid RAG with
  citations), anomalies and forecasts, and proposes changes you approve; it never changes data by itself.
- **Personalised:** onboarding captures your currency, budget, who it's for and your goals; amounts, insights,
  the risk score and the agent's framing follow them.
- **Measured:** offline evals replay recorded model replies on seeded data, so prompts and models can be compared
  without spending quota.

## Stack
Next.js 14 (React 18, TypeScript, Tailwind) on Vercel · FastAPI in front of Flask on Render · Supabase (auth,
Postgres + pgvector, storage) · Groq / Gemini / OpenRouter models behind one client (`backend/llm/`).

## Evaluation
Measured offline from recorded model replies on seeded synthetic data (see `backend/evals/data/LABELLING.md`).

<!-- eval:start -->
_No release results yet._
<!-- eval:end -->

## Run it locally
See **[QUICK_START.md](QUICK_START.md)**. Deploying: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Docs
- [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md): where everything lives and how it fits together
- [docs/direction/](docs/direction/): roadmap, specs, decisions, progress and benchmarks
- [docs/AUTH.md](docs/AUTH.md): how sign-in and token checks work
- [TODO.md](TODO.md): what's next

## Origins
Started at Hack-a-Sol (IIIT Naya Raipur) by team dUnder Pressure: Abhinav Mishra
([@CoderUzumaki](https://github.com/CoderUzumaki)) and Nishant Borkar
([@coderconnoisseur](https://github.com/coderconnoisseur)).

## License
See [LICENSE](LICENSE).
