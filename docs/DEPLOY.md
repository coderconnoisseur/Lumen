# Deploying Lumen (owner runbook)

What runs where (SPEC-DEPLOY): the website on **Vercel**, the API on **Render** (free), auth + Postgres on
**Supabase**, the address on **Namecheap**. After the one-time setup below, merging to `main` redeploys both,
and the API only deploys when CI on `main` is green.

Do the steps in order. Paste secrets only into the dashboards, never into chat or the repo.

## 0. Before you start
- The release PR `refactor` → `main` is merged (Render and Vercel deploy from `main`).
- You know your Supabase database password. If not: Supabase → Project Settings → Database → **Reset database
  password**.

## 1. Supabase (auth + database)
1. **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins** → Save. (Needed by "Try the demo".)
2. **Authentication → URL Configuration**: Site URL `https://lumen.nishantbuilds.me`; Redirect URLs: add
   `https://lumen.nishantbuilds.me/**` (keep `http://localhost:3000/**` for local work).
3. **Connect** (top bar) → **Connection string** → **Session pooler** → copy the URI and replace `[YOUR-PASSWORD]`.
   This is `DATABASE_URL` for Render. The database is in `ap-southeast-1` (Singapore), so `render.yaml` runs the
   API in Render's Singapore region.
4. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`, also `NEXT_PUBLIC_SUPABASE_URL`) and the
   **anon public** key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).

## 2. Render (the API)
1. Sign in at render.com with GitHub. If asked, give the Render GitHub app access to `coderconnoisseur/Lumen`.
2. **New → Blueprint** → pick `coderconnoisseur/Lumen`, branch `main`. It reads `render.yaml` and proposes one
   service, `lumen-api` (free).
3. Fill the four secret values it asks for: `DATABASE_URL` (step 1.3), `SUPABASE_URL` (1.4), `GROQ_API_KEY` and
   `OPENROUTER_API_KEY` (same values as your local `backend/.env`). Everything else is preset. → **Apply**.
4. Wait for the first deploy (5-10 min: it installs the ML packages). Open
   `https://lumen-api.onrender.com/health` (the exact `.onrender.com` name is on the service page): it should say
   healthy and name the Groq tier.
5. Service → **Settings → Custom Domains**: `api.lumen.nishantbuilds.me` is listed (from `render.yaml`). Note the
   target it shows (`lumen-api.onrender.com` or similar) for step 4.

## 3. Vercel (the website)
1. Sign in at vercel.com with GitHub → **Add New → Project** → import `coderconnoisseur/Lumen`.
2. **Root Directory**: `frontend`. Framework: Next.js (auto).
3. **Environment Variables**:
   - `NEXT_PUBLIC_BACKEND_URL` = `https://api.lumen.nishantbuilds.me`
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL (1.4)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public key (1.4)
   - `NEXT_PUBLIC_APP_URL` = `https://lumen.nishantbuilds.me`
4. **Deploy**. Then **Settings → Git**: Production Branch = `main`.
5. **Settings → Domains** → add `lumen.nishantbuilds.me`. Vercel shows a CNAME target (usually
   `cname.vercel-dns.com`).

## 4. Namecheap (the address)
**Domain List → nishantbuilds.me → Manage → Advanced DNS → Add New Record**, twice:

| Type | Host | Value | TTL |
|---|---|---|---|
| CNAME | `lumen` | the Vercel target from 3.5 | Automatic |
| CNAME | `api.lumen` | the Render target from 2.5 | Automatic |

Within ~30 minutes both dashboards show the domain as verified and issue HTTPS certificates on their own.

## 5. Check it (tell me when you're here)
- `https://api.lumen.nishantbuilds.me/health` answers.
- `https://lumen.nishantbuilds.me/signin` → **Try the demo (no sign-up)** → lands on the agent page; ask
  "What is my average electricity bill?".
- The keep-warm job (GitHub → Actions → keep-warm) runs every 10 minutes and turns green.

## How updates go live from now on
Feature PRs merge into `refactor`. A release is a PR `refactor` → `main`: CI runs, and once it's green on `main`,
Render deploys the API and Vercel the website. A red CI run deploys nothing on Render.
