# SPEC-DEPLOY: a stable public link with continuous deployment

Status: **DRAFT for owner review** (one-pager). Owner decisions so far (2026-10-06): Vercel + Render + Supabase on
free tiers, fresh projects under the owner's accounts; domain `nishantbuilds.me` on Namecheap; one-click demo.

## Goal
`https://lumen.nishantbuilds.me` stays the same forever and always runs the latest `main`. A recruiter clicks it,
presses **Try the demo**, and within a minute is asking the agent questions over realistic data. Every merge to
`main` that passes CI redeploys without anyone touching a dashboard.

## Design
```
recruiter ─▶ lumen.nishantbuilds.me      (Vercel: Next.js, production branch = main)
                   │  NEXT_PUBLIC_BACKEND_URL
                   ▼
            api.lumen.nishantbuilds.me  (Render free web service: uvicorn asgi:app, FastAPI + Flask)
                   │                            │
                   ▼                            ▼
            Supabase (Auth + Postgres 16 + pgvector)    Groq free (text) / OpenRouter free (vision)
```
- **Same URL forever:** both hostnames are CNAMEs on Namecheap (`lumen` → Vercel, `api.lumen` → Render). Moving a
  host later means changing one DNS record, not the resume.
- **Database:** the existing Supabase project's Postgres (free tier doesn't expire, pgvector available; `init_db`
  creates the extension and tables). Render's free tier has no IPv6, so `DATABASE_URL` is Supabase's **session
  pooler** string (IPv4).
- **LLMs:** `LUMEN_LLM_TIER=groq` (gpt-oss-120b; free: 1K requests/day, shared by all visitors). Invoice-image
  extraction stays on OpenRouter free vision (~50/day). When a quota runs out the app says so (existing errors).
- **Render free sleeps after 15 min idle** (~1 min to wake). A GitHub Actions cron pings `/health` every 10 min;
  750 free instance-hours/month cover one service around the clock. Cost: $0.
- **`render.yaml`** shrinks to the API only: the email worker (paid) and the Render-hosted frontend are dropped,
  `DATABASE_URL` comes from Supabase, LLM settings move to the Groq tier.

### CI/CD
- PRs into `refactor` run CI (backend tests incl. Postgres + pgvector, offline eval replay, frontend lint).
- **Release = PR `refactor` → `main`.** CI runs on it and on the push to `main`.
- Render: `autoDeployTrigger: checksPass`, so the API deploys only after CI on `main` is green.
- Vercel builds `main` on push (its own build fails on type errors). Previews for other branches stay private.

### One-click demo
- **Try the demo** calls Supabase `signInAnonymously()`: every visitor gets a private, throwaway account (no
  email, no password). The backend already accepts these tokens (`role=authenticated`).
- Then `POST /api/demo/start` seeds that account with the demo data (a year of transactions + 10 documents) by
  reusing `scripts/seed_demo_data.py`; it does nothing if the account already has data. Visitors can't see or
  break each other's data, so there's no shared account to reset.
- Only anonymous accounts can call it. Real sign-up (email + password) is unchanged.
- ponytail: anonymous accounts and their rows accumulate (~0.5 MB each in the 500 MB free database); add a weekly
  cleanup of anonymous users older than 7 days when the database passes ~50%.

## What only the owner can do (I'll give exact click paths and values to paste)
1. Render: new account / Blueprint from `render.yaml`; paste secrets (Groq and OpenRouter keys, Supabase URL,
   `DATABASE_URL`).
2. Vercel: import the repo (root `frontend`), paste the three `NEXT_PUBLIC_*` values.
3. Supabase: enable **anonymous sign-ins**; set Site URL and redirect URLs to `https://lumen.nishantbuilds.me`.
4. Namecheap: two CNAME records; then add both domains in Vercel and Render (free HTTPS).
5. GitHub: allow the Render and Vercel apps on `coderconnoisseur/Lumen`.

## Acceptance criteria
- `https://lumen.nishantbuilds.me` loads over HTTPS; **Try the demo** lands on a dashboard with data in < 90 s
  from a cold start.
- On the live site: an agent question with SQL, one with a document citation, and an invoice upload all work.
- A trivial PR merged to `main` shows up live without manual steps, and a red CI run does **not** deploy.
- No secret in the repo; `/health` reports the Groq tier with the key masked.

## Open questions for the owner
1. Show a "waking up the server…" message while the API is cold, or rely on the keep-warm ping alone?
2. The live demo shares one Groq daily quota. Fine for job applications, or add a per-visitor cap (e.g. 20
   questions/day)?
