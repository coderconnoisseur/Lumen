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
   **anon public** key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`), and the **service_role** key (`SUPABASE_SERVICE_ROLE_KEY`, for
   Render only: the API keeps original uploads in a private Storage bucket, `lumen-files`, created on first upload).
5. **Google sign-in** (off until this is done; the button then lands on Supabase's "provider is not enabled" page):
   - Google Cloud Console → **APIs & Services → OAuth consent screen**: External, app name Lumen, your support email,
     authorized domain `nishantbuilds.me`; scopes are only email and profile. **Publish app** (In production), or only
     listed test users can sign in.
   - **Credentials → Create credentials → OAuth client ID** → Web application. Authorized JavaScript origin
     `https://lumen.nishantbuilds.me`; authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Supabase **Authentication → Sign In / Providers → Google**: enable, paste the client ID and secret, Save.
   - **Gmail inbox ingestion** (optional; same Google Cloud project): **APIs & Services → Library** → enable
     **Gmail API**. On the consent screen add the scope `.../auth/gmail.readonly` and, while the app is in Testing,
     your address under **Test users**. In the same OAuth client add the authorized redirect URI
     `https://lumen.nishantbuilds.me/oauth/gmail`. On Render set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
     `GOOGLE_REDIRECT_URI=https://lumen.nishantbuilds.me/oauth/gmail` and `EMAIL_POLLING=1`. Note: `gmail.readonly` is
     a restricted scope; public use needs Google's verification, test users work without it.
     While the app is in Testing, Google expires refresh tokens after 7 days: reconnect Gmail from the email card then.
6. **Email sending** (sign-up confirmation and password reset links). Supabase's built-in mailer only delivers to the
   project team's own addresses, a few an hour, so real visitors never get the link. Use your own SMTP, e.g. Resend
   (free tier):
   - resend.com → **Domains → Add** `nishantbuilds.me` → add the DNS records it lists in Namecheap (**Advanced DNS**)
     → Verify. Then **API Keys → Create**.
   - Supabase **Authentication → Emails → SMTP Settings** → enable custom SMTP: host `smtp.resend.com`, port `465`,
     username `resend`, password = the API key, sender `no-reply@nishantbuilds.me`, sender name `Lumen`. Save.
   - **Authentication → Rate Limits**: raise "emails sent per hour" (custom SMTP starts at 30).
   - Stopgap without SMTP: **Sign In / Providers → Email** → turn off **Confirm email**. Sign-ups then log in at once
     (nobody proves they own the address) and password reset emails still won't reach visitors.

## 2. Render (the API)
The API runs as **`lumen-api-sg`** in Render's **Singapore** region, next to the database (created 2026-10-09 with the
non-secret settings already filled in). An older `lumen-api` service in Oregon came from the first blueprint run; it
never went live (its `DATABASE_URL` was Supabase's direct address, which is IPv6-only and unreachable from Render's
free tier). Delete it: open it → **Settings** → bottom of the page → **Delete Web Service**.

1. Open `lumen-api-sg` → **Environment** → **Add Environment Variable**, and add:
   - `DATABASE_URL`: the **Session pooler** URI from step 1.3 (host ending in `pooler.supabase.com`, port
     `5432`, user `postgres.<project ref>`). Not the "Direct connection" one.
   - `SUPABASE_SERVICE_ROLE_KEY` (1.4, the **service_role** key: server only, never in the frontend).
   - `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`: same values as your local `backend/.env`.
   - `SECRET_KEY` and `EMAIL_ENCRYPTION_KEY`: click **Generate** for each.

   → **Save, rebuild, and deploy**.
2. **Settings**: Health Check Path = `/health`; Auto-Deploy = **After CI checks pass**; Build Command =
   `cd backend && pip install -r requirements.txt && python -m scripts.fetch_models` (downloads the document-search
   models during the build, so the first question doesn't wait about 40 s for them).
3. Wait for the deploy (5-10 min: it installs the ML packages), then open the service's `.onrender.com` URL +
   `/health`: it should say healthy and name the Groq tier.
4. **Settings → Custom Domains → Add**: `api.lumen.nishantbuilds.me`. Note the target it shows (the service's
   `.onrender.com` host) for step 4.

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
- `https://lumen.nishantbuilds.me/demo` → lands on the agent page; ask
  "What is my average electricity bill?".
- The keep-warm job (GitHub → Actions → keep-warm) runs every 10 minutes and turns green.

## How updates go live from now on
Feature PRs merge into `refactor`. A release is a PR `refactor` → `main`: CI runs, and once it's green on `main`,
Render deploys the API and Vercel the website. A red CI run deploys nothing on Render.
