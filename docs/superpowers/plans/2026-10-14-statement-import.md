# Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users import a bank/card CSV statement; every debit line becomes a categorised transaction without duplicates.

**Architecture:** A pure-Python package `backend/statements/` (CSV reading, header detection, mapping, row parsing,
vendor cleaning, categories) is unit-tested without HTTP. A FastAPI router `backend/api/statements.py` exposes
preview and import, writing `transactions` rows with two new nullable columns. A bare-bones `/import` page in the
Next.js app calls it.

**Tech Stack:** Python 3.11 stdlib `csv`/`hashlib`, existing `utils.normalize` (`parse_date`, `clean_amount`),
SQLAlchemy Core/ORM, FastAPI, pytest; Next.js 14 + existing `apiClient`.

**Spec:** `docs/direction/specs/SPEC-STATEMENTS.md`

## Global Constraints
- CSV only, ≤ 5 MB (`MAX_BYTES = 5 * 1024 * 1024`); delimiter comma, semicolon or tab; header row within the first 30 rows.
- Debits only become transactions; credits are counted and skipped.
- New columns via `_ADDED_COLUMNS` only: `transactions.source VARCHAR`, `transactions.import_key VARCHAR`. No unique index.
- `import_key = sha1(f"{user_id}|{date}|{amount:.2f}|{raw_description}")` hex.
- Already-recorded match: same user, `abs(amount - t.total_amount) < 0.01`, date within ±3 days, and at least one
  shared lowercase word (≥ 3 letters) between the cleaned vendor and `t.vendor_name`; only rows where `source` is NULL
  (invoices) are candidates.
- Imported rows: `source="statement"`, `currency` = the request's currency (default profile currency, else `Config.DEFAULT_CURRENCY`), `invoice_number=None`.
- Rate limit `10 per minute`; any signed-in user (demo included).
- Follow repo style: tabs in TS, 4 spaces in Python, short comments explaining why.

## Review Focus
1. A bank CSV with a UTF-8 BOM or Latin-1 characters (₹, é) must still parse.
2. Amounts like "1,234.50", "1,234.50 Dr", "-499.00", "(499.00)" must get the right sign and value.
3. Re-importing the same file must import 0 rows (all duplicates), including rows that were "already recorded".
4. Another user's invoices must never count as "already recorded".
5. A CSV with no recognisable header must return a helpful 400 with raw rows, not a 500.

---

### Task 1: columns and the `statements` package

**Files:**
- Modify: `backend/models/__init__.py` (Transaction: `source`, `import_key` columns, nullable String)
- Modify: `backend/models/database.py` (`_ADDED_COLUMNS["transactions"]` += `("source", "VARCHAR"), ("import_key", "VARCHAR")`)
- Create: `backend/statements/__init__.py` (empty), `backend/statements/read.py`, `backend/statements/vendor.py`
- Test: `backend/tests/test_statements.py`

**Interfaces (Produces):**
- `read.decode(data: bytes) -> str` — UTF-8 (BOM stripped) with Latin-1 fallback.
- `read.rows(text: str) -> list[list[str]]` — `csv.Sniffer` delimiter among `,;\t` (fallback `,`), blank rows dropped.
- `read.find_header(rows) -> int | None` — index of the first row (in rows[:30]) with a date-like header cell and an amount-like header cell (debit/credit/amount synonyms).
- `read.guess_mapping(header: list[str]) -> dict` — keys `date, description, debit, credit, amount, drcr`, values column index or None, by the spec's synonym table (case-insensitive, whitespace/punctuation-insensitive exact or startswith match).
- `read.parse(rows, header_index, mapping) -> list[Line]` where `Line = dataclass(line: int (1-based file line), date: str|None, description: str, amount: float|None, kind: "debit"|"credit"|None)`; `kind`/`amount` positive from: debit column (>0 → debit), credit column (>0 → credit), or signed amount (negative → debit) with Dr/Cr marker overriding (`dr`/`debit` → debit, `cr`/`credit` → credit); amount strings may carry `Dr`/`Cr` suffix or parentheses for negatives.
- `vendor.clean(description: str) -> str` and `vendor.category(vendor_or_description: str) -> str`.

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_statements.py`):

```python
"""SPEC-STATEMENTS: reading bank/card CSV statements."""
import pytest

from statements import read, vendor

HDFC = """HDFC BANK Ltd.,,,,,,
Statement of account,,,,,,
Account No : 50100123456789,,,,,,
,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,UPI/NETFLIX.COM/9876543210/Payment,0000123,01/10/26,649.00,,50351.00
02/10/26,NEFT-ACME CORP SALARY,0000124,02/10/26,,85000.00,135351.00
05/10/26,POS 4111XXXXXXXX1234 SWIGGY BANGALORE,0000125,05/10/26,"1,234.50",,134116.50
,,,,,,
"""
CARD = """Transaction Date,Description,Amount
2026-10-03,AMAZON.IN MARKETPLACE,-2499.00
2026-10-04,PAYMENT RECEIVED - THANK YOU,15000.00
2026-10-06,UBER *TRIP,-312.40
"""
SEMI = """Datum;Beschreibung;Betrag;Typ
07.10.2026;SPOTIFY AB;12,99;Dr
08.10.2026;Refund SPOTIFY;12,99;Cr
"""


def _parse(text):
    rows = read.rows(text)
    h = read.find_header(rows)
    return read.parse(rows, h, read.guess_mapping(rows[h]))


def test_hdfc_style_preamble_withdrawal_deposit_and_day_first_dates():
    rows = read.rows(HDFC)
    h = read.find_header(rows)
    assert rows[h][0] == "Date"
    m = read.guess_mapping(rows[h])
    assert (m["date"], m["description"], m["debit"], m["credit"]) == (0, 1, 4, 5)
    lines = _parse(HDFC)
    assert [(l.date, l.amount, l.kind) for l in lines] == [
        ("2026-10-01", 649.0, "debit"), ("2026-10-02", 85000.0, "credit"), ("2026-10-05", 1234.5, "debit")]


def test_card_export_signed_amount_negative_is_spend():
    lines = _parse(CARD)
    assert [(l.amount, l.kind) for l in lines] == [(2499.0, "debit"), (15000.0, "credit"), (312.4, "debit")]


def test_semicolon_with_dr_cr_marker_and_decimal_comma():
    rows = read.rows(SEMI)
    h = read.find_header(rows)
    m = read.guess_mapping(rows[h])
    assert m["amount"] == 2 and m["drcr"] == 3
    lines = read.parse(rows, h, m)
    assert [(l.date, l.amount, l.kind) for l in lines] == [("2026-10-07", 12.99, "debit"), ("2026-10-08", 12.99, "credit")]


@pytest.mark.parametrize("raw, value, kind", [
    ("1,234.50 Dr", 1234.5, "debit"), ("1,234.50 Cr", 1234.5, "credit"), ("(499.00)", 499.0, "debit"), ("-499", 499.0, "debit"),
])
def test_amount_signs_in_a_single_amount_column(raw, value, kind):
    rows = [["Date", "Description", "Amount"], ["01/10/2026", "X", raw]]
    (line,) = read.parse(rows, 0, read.guess_mapping(rows[0]))
    assert (line.amount, line.kind) == (value, kind)


def test_unreadable_rows_keep_their_file_line_number():
    rows = read.rows("Date,Description,Amount\nnot a date,X,-5\n01/10/2026,Y,abc\n")
    lines = read.parse(rows, 0, read.guess_mapping(rows[0]))
    assert [(l.line, l.date, l.amount) for l in lines] == [(2, None, 5.0), (3, "2026-10-01", None)]


def test_no_header_found():
    assert read.find_header(read.rows("foo,bar\n1,2\n")) is None


def test_decode_bom_and_latin1():
    assert read.decode("﻿Date,Amount\n".encode("utf-8")).startswith("Date")
    assert "é" in read.decode("Caf\xe9".encode("latin-1"))


@pytest.mark.parametrize("raw, clean, cat", [
    ("UPI/NETFLIX.COM/9876543210/Payment", "Netflix.com", "Subscriptions"),
    ("POS 4111XXXXXXXX1234 SWIGGY BANGALORE", "Swiggy Bangalore", "Food"),
    ("UBER *TRIP", "Uber Trip", "Transport"),
    ("AMAZON.IN MARKETPLACE", "Amazon.in Marketplace", "Shopping"),
    ("NEFT-TATA POWER ELECTRICITY 12345", "Tata Power Electricity", "Utilities"),
    ("IMPS/P2A/123456/RAHUL", "Rahul", "Other"),
])
def test_vendor_cleaning_and_category(raw, clean, cat):
    assert vendor.clean(raw) == clean
    assert vendor.category(raw) == cat
```

- [ ] **Step 2: Run** `pytest tests/test_statements.py -q` (from `backend/`, with CI env: `OPENROUTER_API_KEY=test-key SECRET_KEY=test-secret-key-for-ci-only SUPABASE_URL=https://example.supabase.co`). Expected: FAIL, `ModuleNotFoundError: statements`.
- [ ] **Step 3: Implement** `read.py` and `vendor.py` to the interfaces above. Notes: decimal comma (`12,99` with no other separator and two trailing digits) means a decimal point; reuse `utils.normalize.parse_date` (day-first) and `clean_amount` after normalising sign markers; vendor cleaning removes rail prefixes (`UPI`, `POS`, `NEFT`, `IMPS`, `RTGS`, `ACH`, `NACH`, `P2A`, `P2M`, `Payment`), tokens with ≥ 4 digits or masked cards (`X{4,}`), `*` and `/`/`-` separators, then Title Case keeping dots (`Netflix.com`); category keyword table (lowercase substring): Subscriptions: netflix, spotify, prime video, hotstar, youtube, apple.com/bill, google *; Food: swiggy, zomato, restaurant, cafe; Transport: uber, ola, rapido, irctc, metro, fuel, petrol; Shopping: amazon, flipkart, myntra, ajio; Utilities: electricity, power, water, gas, broadband, airtel, jio, vodafone; Groceries: bigbasket, blinkit, zepto, dmart; Health: pharmacy, apollo, hospital; else Other. Add the two columns to the model and `_ADDED_COLUMNS`.
- [ ] **Step 4: Run** the tests → PASS; then the full suite `pytest -q` → green.
- [ ] **Step 5: Commit** `git commit -m "Statement reader: header detection, mapping, signs, vendor cleaning (SPEC-STATEMENTS)"`.

### Task 2: preview and import API

**Files:**
- Create: `backend/api/statements.py`; Modify: `backend/asgi.py` (register router)
- Test: `backend/tests/test_api_statements.py`

**Interfaces:**
- Consumes: Task 1 (`read.*`, `vendor.*`), `api.profile.ensure_user` (creates the users row, FK on Postgres), `api.profile.load_profile`-style currency default (`users.currency`), `api.deps.current_user, rate_limit`.
- Produces: `POST /api/statements/preview` (multipart `file`) → `{"success": true, "columns": [...], "mapping": {...}, "header_line": int, "sample": [5 lines as dicts], "counts": {"rows", "debits", "credits", "unreadable"}}`; 400 `{"detail": {"message": "...", "raw": first 10 rows}}` when no header. `POST /api/statements/import` (multipart `file`, form `mapping` JSON string, form `currency` optional, form `header_line` optional int) → `{"success": true, "imported", "duplicates", "matched", "credits", "unreadable": [line numbers]}`. `get_engine` dependency like `api/profile.py` (overridable in tests).

- [ ] **Step 1: Failing tests** — follow the fixture style of `tests/test_api_profile.py` (sqlite engine, `create_app(statements.router)`, `dependency_overrides[statements.get_engine]`, `verify_token` monkeypatched, `bearer()` helper). Cases: preview of the CARD csv returns mapping and counts `{rows:3, debits:2, credits:1, unreadable:0}`; import CARD → `imported == 2, credits == 1`, rows in `transactions` with `source='statement'`, vendor cleaned, category set, currency from the user's profile (set `users.currency='CHF'` first) or the form; importing CARD again → `imported == 0, duplicates == 2`; an existing invoice row for the same user (`vendor_name="Amazon"`, `total_amount=2499.0`, date 2 days later, `source` NULL) → that line `matched == 1`, not imported; the same invoice under **another** user doesn't match; a file with no header → 400 with `raw`; a non-text binary (`b"\x89PNG..."`) → 400; > 5 MB → 413; mapping override (swap description column) is honoured.
- [ ] **Step 2: Run** → FAIL (404/ImportError).
- [ ] **Step 3: Implement**; reject non-CSV by content (decode fails or no delimiter-separated rows with ≥ 2 columns). Insert with SQLAlchemy ORM `Transaction(...)`; fetch the user's existing `import_key`s once and the candidate invoice rows once (dates within the file's range ±3 days), then match in Python.
- [ ] **Step 4: Run** tests → PASS; full `pytest -q` → green.
- [ ] **Step 5: Commit** `"Statement import API: preview and import with duplicate and invoice matching (SPEC-STATEMENTS)"`.

### Task 3: `/import` screen and docs

**Files:**
- Modify: `frontend/src/lib/api/client.ts` (`statementApi.preview(file)`, `statementApi.import(file, mapping, currency, headerLine)` using multipart like `profileApi.uploadAvatar` with `headers: { "Content-Type": undefined }`)
- Create: `frontend/src/app/(app)/import/page.tsx` (metadata title "Import statement") and `importContent.tsx` ("use client")
- Modify: `frontend/src/components/app-sidebar.tsx` (projects list: `{ name: "Import statement", url: "/import", icon: Upload }` from lucide-react, after Documents)
- Modify: `docs/CODEBASE-GUIDE.md` (statements section), `docs/direction/PROGRESS.md` (dated entry), `TODO.md` (tick "statements CSV")

- [ ] **Step 1:** Screen inside `DashboardShell title="Import a statement" description="CSV from your bank or card. Spending lines become transactions; credits are skipped for now."`: a file input (accept `.csv,text/csv`); on choose → preview → a mapping row of `<select>`s (date, description, debit, credit, amount, Dr/Cr; options = column names plus "—"), a currency `<select>` (profile currency default via `useProfile`), a 5-row preview table (date, description, amount, kind), counts; **Import** button (keeps its label with a spinner while running) → result line "Imported N · D duplicates · M already recorded · C credits skipped · unreadable lines: …" and a link to `/dashboard`. Errors from the API show inline with the raw rows table when present. Native selects get explicit `bg-background text-foreground`.
- [ ] **Step 2:** `npm run build` and `npx next lint` pass.
- [ ] **Step 3:** Browser check against a local API (throwaway launcher, not committed): upload the CARD sample, change one mapping, import, see the rows on the dashboard; re-import shows duplicates.
- [ ] **Step 4: Commit** `"Import statement screen (bare bones) and docs (SPEC-STATEMENTS)"`.
