# SPEC-STATEMENTS: import bank and card statements (CSV)

Status: **DRAFT for owner review**. Owner decisions (2026-10-14): CSV first (PDF statements later, reusing the same
importer); this is step 1 of "build what the landing page claims" because budgets, subscriptions, savings and cash
flow all need real transaction volume, which invoices alone don't give.

## Goal
A user downloads a CSV statement from their bank or card, drops it into Lumen, checks a 5-row preview, and every
spending line becomes a transaction, categorised, in their currency, without duplicates: importing the same file
twice, or a statement that overlaps an invoice already read from email, never double-counts.

## Scope
- **In:** CSV files up to 5 MB from any bank or card (comma, semicolon or tab separated; preamble rows above the
  header, as HDFC/ICICI/SBI exports have); debit lines become transactions.
- **Out (later specs):** PDF and XLS statements; **credits / income** (salary, refunds) — they need a separate
  "money in" notion so spend totals stay right, and land with the cash-flow spec; bank connections (Account
  Aggregator / Plaid); editing imported rows (the existing invoice edit dialog works on them).

## How it works
1. **Read** the file (`csv.Sniffer` for the delimiter, UTF-8 with a Latin-1 fallback).
2. **Find the header row:** the first row in the top 30 whose cells name a date column and an amount column
   (case-insensitive synonyms below). Rows above it are preamble.
3. **Guess the mapping** from header synonyms:
   | Field | Header synonyms (any of) |
   |---|---|
   | date | date, txn date, transaction date, value date, posting date |
   | description | description, narration, particulars, details, remarks, merchant |
   | debit | debit, withdrawal, withdrawal amt, dr, amount debited, paid out |
   | credit | credit, deposit, deposit amt, cr, amount credited, paid in |
   | amount (signed) | amount, transaction amount (negative = spend, or a Dr/Cr column) |
   | dr/cr marker | dr/cr, type, cr/dr |
   Either debit (+ optional credit) or a signed amount (+ optional Dr/Cr marker) is required.
4. **Preview:** the user sees the guessed mapping as dropdowns, the first 5 parsed rows, and counts (rows, spends,
   credits skipped, unreadable). They can change any mapping and the currency (default: profile currency).
5. **Import** (the browser re-sends the file with the confirmed mapping; nothing is stored between the two steps):
   - date → `utils.normalize.parse_date` (day-first); amount → `clean_amount`, sign from the debit/credit column, a
     negative amount or a Dr marker. Rows with no date or no amount are reported, not imported.
   - **vendor** from the description: strip payment-rail noise (`UPI/`, `POS`, `NEFT`, `IMPS`, `ACH`, reference
     numbers, card digits), keep the first meaningful words, Title Case (`UPI/NETFLIX.COM/9876543` → `Netflix.com`).
   - **category** from a small keyword table (Netflix/Spotify → Subscriptions, Swiggy/Zomato → Food, Uber/Ola →
     Transport, Amazon/Flipkart → Shopping, electricity/power → Utilities, …), else `Other`. ponytail: keyword
     table, an LLM batch categoriser when `Other` dominates real imports.
   - **duplicates:** each row gets `import_key = sha1(user, date, amount, raw description)`; a key already present
     is skipped (re-importing a file is a no-op). A row is also skipped as **already recorded** when an existing
     transaction (an invoice from upload or email) has the same amount, a date within ±3 days, and a vendor that
     shares a word with the cleaned description. ponytail: heuristic match; show matches for confirmation if real
     data shows false merges.
   - writes `transactions` rows with `source = "statement"`, `currency`, no `invoice_number`.
6. **Result:** "Imported 142 · 9 already recorded · 31 credits skipped (income comes later) · 2 unreadable rows
   (line 57, 88)".

## Data
New nullable columns on `transactions` via `_ADDED_COLUMNS`:
| Column | Type | Notes |
|---|---|---|
| `source` | `VARCHAR` | `statement` for imports; NULL = existing rows (invoices, receipts, email) |
| `import_key` | `VARCHAR` | sha1 described above; checked in code before insert |
ponytail: no unique index on `import_key` (adding one to an existing table needs a migration step); one user imports
one file at a time, so a code check is enough. Add the index if concurrent imports ever happen.

## API (FastAPI, `backend/api/statements.py`)
- `POST /api/statements/preview` (multipart `file`) → `{mapping, columns, sample: [5 parsed rows], counts}`; 400 with
  a plain message when no header row is found ("Couldn't find a date and amount column. Pick them below.") plus the
  raw first rows so the user can map by hand.
- `POST /api/statements/import` (multipart `file`, `mapping` JSON, `currency`) → `{imported, duplicates, matched,
  credits, unreadable: [line numbers]}`.
- Both: 5 MB limit, CSV only (by content, not extension), rate limit 10/min, any signed-in user (demo included: it's
  their own sandbox data).
- Logic lives in `backend/statements/` (`read.py`: delimiter, header, mapping, row parsing; `vendor.py`: cleaning and
  categories) so it's testable without HTTP.

## Screen (bare bones until the inner-app revamp)
`/import` in the app (sidebar: "Import statement"): file picker → mapping dropdowns + 5-row preview + counts →
**Import** → result line with a link to the dashboard. Uses the existing app components; no new design work.

## Testing
- Unit (`tests/test_statements.py`) with small synthetic CSVs in the test file: HDFC-style (preamble rows, separate
  Withdrawal/Deposit columns, `dd/mm/yy`), a card export (signed amount, negative = spend), semicolon with a Dr/Cr
  column; header detection, mapping guess, sign handling, day-first dates, vendor cleaning and categories (table of
  description → vendor/category cases).
- API: preview then import; re-import is a no-op (all duplicates); a row matching an emailed invoice (same amount,
  2 days apart, shared word) is skipped as already recorded; credits counted and skipped; unreadable lines reported;
  a non-CSV file → 400; another user's transactions are never matched.
- Browser: upload a sample statement through `/import`, change one mapping, import, see the rows on the dashboard.

## Build order (one PR)
1. Columns + `statements/` reader and vendor cleaner with unit tests.
2. API with tests.
3. `/import` screen and sidebar link; docs (CODEBASE-GUIDE, PROGRESS).

## Later (noted, not in this spec)
- Subscriptions: the Gmail poller already turns emailed receipts (Netflix, Spotify, …) into transactions, so the
  subscriptions spec starts from email and uses statements as a second source.
- Forecast: the cash-flow spec uses a proper time-series model (seasonality, trend, intervals), not moving averages.
