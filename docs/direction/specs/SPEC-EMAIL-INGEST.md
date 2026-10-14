# SPEC-EMAIL-INGEST: every transaction from your inbox

Status: **APPROVED (owner, 2026-10-14): A + B** (Gmail OAuth in testing mode, IMAP kept as "Other provider"). Owner decision (2026-10-14): email is the **primary** way transactions get in
(banks, card issuers, Zomato, Netflix, autopay all send email); CSV statements stay as the fallback.

## Where we are (2026-10-14)
- IMAP with an app password only; the "Connect Gmail" button calls endpoints that return 501.
- Only **attachments** are read (PDF/image invoices). Bank debit alerts, order emails and autopay notices have no
  attachment, so they're ignored.
- **The poller doesn't run in production**: it only starts in the Flask dev runner and in `worker.py`, which Render
  no longer runs. `POST /api/v1/email-config/poll-now` works on demand.
- No Message-ID dedup: with "mark as read" off, a message can be read twice.

## Goal
Connect your inbox once; from then on every spend that produces an email (bank/card/UPI alerts, receipts, orders,
subscription renewals) becomes a transaction within minutes, without duplicates, including against CSV imports and
invoices.

## Decision for the owner: how users connect
| | **A. Gmail sign-in (OAuth)** | **B. IMAP + app password (exists)** |
|---|---|---|
| User effort | One "Allow" click | Turn on 2FA, create an app password, paste it |
| Google rules | `gmail.readonly` is a **restricted** scope: until Google verifies the app (OAuth review + a paid CASA security assessment), it works for up to **100 test users** you list, with an "unverified app" warning | none |
| Other providers | Gmail only | Gmail, Outlook, Yahoo, any IMAP |

**Recommendation:** build **A for Gmail** (in "testing" mode: you add yourself and testers; fine for a resume demo)
and keep **B** as "Other email provider". Verification can come later without code changes.

## Design
1. **Run it in production:** the API process starts the existing `EmailPollingScheduler` thread at startup when
   `EMAIL_POLLING=1` (one uvicorn worker; the keep-warm job already stops Render sleeping). Every 10 minutes it polls
   each connected inbox. ponytail: an in-process thread; a separate worker if users grow past what one process polls
   in a cycle.
2. **Gmail OAuth (A):** `GET /api/v1/email-config/gmail/auth-url` → Google consent (`gmail.readonly`, offline access);
   `/gmail/callback` exchanges the code, stores the refresh token **encrypted** (`utils/crypto.encrypt_secret`) in the
   existing `oauth_refresh_token` column; the poller uses the Gmail API with a search query instead of IMAP. The
   existing frontend button and API calls (`gmailOAuthButton.tsx`, `emailConfigApi.getGmailAuthUrl/gmailCallback`)
   are reused. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
3. **Pick only money emails:** Gmail query / IMAP search over the last 30 days (first run) or since the last poll,
   for messages with money words (`debited`, `spent`, `charged`, `paid`, `payment`, `receipt`, `invoice`, `order`,
   `renewal`, `subscription`, `UPI`) or an invoice attachment. Promotional/marketing mail is skipped by a sender and
   subject filter (`offer`, `sale`, `% off`, `newsletter`).
4. **Read the body:** one structured text-LLM call (the `text` role; under SPEC-BYOK the user's own key and the catalogue's model) per
   candidate email returns `{is_transaction, direction: debit|credit, amount, currency, merchant, date, kind:
   alert|receipt|order|subscription|other, reference}` validated by Pydantic; `is_transaction=false` → skipped. Email
   text is data, not instructions (same injection rule as invoices). Attachments keep the existing invoice path
   (`read_with_feedback` → review queue).
5. **Save:** debits become transactions (`source="email"`, merchant → vendor via the statement vendor cleaner,
   category via its keyword table, `import_key` from the Message-ID); credits are counted and skipped (income comes
   with the cash-flow spec), same rule as statements.
6. **No duplicates:** a `processed_emails` table (user, message-id) so a message is read once; and the statement
   matcher (same amount, ±3 days, shared vendor word) so a bank alert and the Netflix receipt for the same charge, or
   an email and a CSV line, count once. An invoice attachment and its own body are one message → one transaction.
7. **When it runs (owner asked):** automatically every 10 minutes for every connected inbox (the in-process scheduler;
   Render's free plan has no cron jobs; fallback: a GitHub Actions cron calling a secret-protected poll endpoint), a
   30-day backfill on first connect, and a **Check now** button.
8. **Subscriptions from email:** after each poll, recurring detection (same merchant, similar amount, monthly/yearly
   rhythm) runs over the user's transactions; an email the parser tags `subscription`/renewal marks the merchant as a
   subscription at once, without waiting for a second charge. (The subscriptions spec builds the list and nudges.)
9. **Settings screen (bare bones):** "Connect Gmail" / "Other provider (IMAP)", status (last poll, emails read,
   transactions added, last error), "Check now", pause, disconnect (deletes the token).

## Privacy
Only candidate emails are sent to the model, bodies are not stored (only the parsed fields and the Message-ID),
tokens are encrypted, disconnect deletes them, and the consent screen says exactly what's read.

## Testing
- Unit: the candidate filter (alerts, receipts, orders in; promos out) on a table of sample subjects/bodies; the
  body parser with a recorded LLM reply (cassette) and malformed replies; dedup by Message-ID; cross-source match.
- API: OAuth callback stores an encrypted token (Google mocked); poll-now with a fake Gmail client inserts the right
  transactions and skips credits/promos/duplicates; scheduler starts only with `EMAIL_POLLING=1`.
- Owner: connect your own Gmail on the live site (testing mode) and check the next poll.

## Owner steps
Google Cloud → the same OAuth client as Google sign-in (or a new one) → enable the Gmail API, add scope
`gmail.readonly`, add test users (you), add the redirect URI; put the three env vars on Render.

## Out of scope
SMS reading (Android only, needs an app), Outlook OAuth, Google verification/CASA, income/cash flow.
