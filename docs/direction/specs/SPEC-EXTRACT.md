# SPEC-EXTRACT: structured extraction, validation and the review queue

Status: **DRAFT for owner review** (one-pager). Covers roadmap **EXT-01 … EXT-04** and builder finding 6b **#5**
(currency). Uses EVAL-02's 40 labelled invoices with planted faults.

## Goal
An AP tool's value is catching the bad invoice, not reading the good one. Every upload is extracted into a
validated structure, checked against purchase orders and history, scored for confidence, and anything doubtful
lands in a human review queue instead of silently becoming a transaction.

## Design
| Part | Choice | Why |
|---|---|---|
| **Structured extraction** (EXT-01) | One vision call with a JSON schema (`response_format` where the model supports it, e.g. Gemma and Qwen; otherwise schema in the prompt), validated by a Pydantic model: vendor, invoice number, date, currency, PO number, line items, subtotal, tax, total, payment method, address. | Replaces "please reply in JSON" plus parsing. Adds `currency` and `po_number` (stored, not converted; fixes 6b #5) and line items. |
| **Validation rules** (EXT-02), deterministic | totals vs line items (± 1%); duplicate (same user + vendor + invoice number); vendor known / PO exists and matches vendor and amount (`purchase_orders` table, built from the generator's rows); date sanity (not in the future, not older than 2 years); currency present. | Each planted fault in EVAL-02 has exactly one rule that should catch it, so detection is measurable per fault type. |
| **Injection handling** (EXT-04) | The prompt treats invoice text as data; a heuristic flags instruction-like text ("ignore previous instructions", "AI assistant", URLs in notes) as `possible_injection`; extracted values can never be "approved" by text on the invoice. | The baseline will show whether today's reader follows the planted injections. |
| **Confidence + status** (EXT-03) | Confidence from the checks (all pass = high; any warning = medium; any failure = low). State machine `extracted → flagged → approved / rejected`; only `approved` invoices become transactions automatically; flagged ones wait in `review_items` with the reasons. | Confidence from verifiable checks, not from asking the model how sure it is. |
| **Review queue API** | FastAPI `GET /api/review`, `POST /api/review/{id}/approve`, `.../reject`, `PATCH` (edit fields then approve); every action audit-logged. | The human-in-the-loop half of the IDEA demo. |

## Evaluation
- Field-level F1 per field and per variant (clean vs degraded), against the EXT-01 schema (the baseline used the
  7 legacy fields).
- **Fault detection per type:** recall and precision of flags against the planted faults (total mismatch,
  duplicate, unknown vendor, bad date, injection), plus the false-flag rate on the 24 clean invoices.
- Safety: injected invoices never change a stored value and are always flagged.

## Acceptance criteria
1. Pydantic validation rejects malformed model output (one retry, then flagged as unreadable).
2. Each planted fault type is caught by its rule on the dev split; false flags on clean invoices are reported.
3. No invoice becomes a transaction without passing checks or a human approval; every transition is logged.

## Open question for the owner
- Auto-approve "high confidence" invoices, or send every invoice through review in the demo? Recommendation:
  auto-approve high confidence (it shows the value of validation), queue the rest.
