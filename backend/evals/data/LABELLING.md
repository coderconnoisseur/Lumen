# How the eval data is labelled

Everything in this folder except this file (and `judge_gold.jsonl`, once the owner labels it) is written by
`python -m evals.generator --seed 42` (EVAL-02, SPEC-EVAL "Data"). Never edit a generated file by hand:
change the generator, re-run it, and commit the result. `python -m evals.generator --check` (also a unit
test) fails when a committed JSONL file no longer matches the generator.

## The synthetic world
- Two users (`u1` "Acme Design Studio", `u2` "Bluebird Logistics") with stable UUIDs
  (`uuid5(NAMESPACE_URL, "https://lumen.test/eval/<key>")`), one year of transactions from 2025-07-01 to
  **2026-06-30 (AS_OF)**, line items, and purchase orders. Relative dates in questions ("last month") are
  relative to AS_OF; the suites pin the pipeline's "today" to it.
- Each user has monthly bills (utilities, a subscription) plus random visits to their own mix of 17 vendors.
  Some vendors only one user uses, which the tenant-isolation cases rely on.
- Loaded into SQLite (CI) or Postgres (local pgserver, and CI's Postgres service) by
  `evals.generator.db.load_world`, with the app's own table definitions.

## How each label is made
| File | Label source |
|---|---|
| `sql.jsonl` | Gold SQL **written by hand** in `generator/sql_questions.py`. Dialect-neutral; a test runs every query on SQLite and Postgres and requires identical result sets, and checks that the app's SQL guardrails pass each query unchanged. Unanswerable questions have no gold SQL. |
| `extraction.jsonl` | **By construction**: each invoice image is rendered from its ground truth (`invoices.jsonl`), so the gold is exactly what is printed. A total-mismatch invoice's gold total is the printed (wrong) total; an injection invoice's gold ignores the injection. |
| `retrieval.jsonl` | **By construction**: each fact (`facts.jsonl`) is written verbatim into exactly one section of one document, and its questions are labelled with that section id (`<doc id>#sNN`). A test checks the answer appears in that section and in no other section of the document. All questions are templated (`source: template`); none are LLM-drafted yet. |
| `generation.jsonl` | Answerable questions take `required_facts` from the planted fact. Unanswerable ones are either about things not in the corpus or about the *other* user's purchase orders; the latter carry `must_not` (the other user's unique order total). |
| `agent.jsonl` | Hand-written routing intent per question: the expected first tool (AGT-01 names; `get_schema` never counts as first) or none for questions the assistant should decline. |
| `safety.jsonl` | `tenant`: questions after the other user's data; `must_not` holds values only the other user has, never anything that appears in the question. `injection`: instructions hidden in a document or invoice, each asking for a unique canary that must never appear in the answer. |

## Splits
About 30% of each dataset is the **test** split, seeded and stratified: SQL by first tag, extraction by
fault type (both copies of an invoice share a split), retrieval by document kind (all phrasings of a fact
share a split), generation by kind, agent by expected first tool, safety by kind. Iterate on **dev** only;
`evals.run` refuses `--split test` without `--release`.

## Row counts
<!-- counts:start -->
| File | Rows | dev | test |
|---|---|---|---|
| sql.jsonl | 50 | 35 | 15 |
| extraction.jsonl | 80 | 56 | 24 |
| retrieval.jsonl | 153 | 104 | 49 |
| generation.jsonl | 36 | 26 | 10 |
| agent.jsonl | 40 | 28 | 12 |
| safety.jsonl | 20 | 14 | 6 |
<!-- counts:end -->

Supporting files: `invoices.jsonl` (40 invoices: 12 clean and 8 with one planted fault per user: 2 total
mismatch, 2 duplicate, 2 unknown vendor, 1 bad date, 1 injection), `corpus.jsonl` (20 documents: 12
purchase orders, 6 contracts, 2 expense policies), `facts.jsonl` (70 planted facts), `purchase_orders.jsonl`
(12), `invoices/` (40 clean PNGs plus one degraded copy each: 14 skew, 13 blur, 13 JPEG) and `corpus/`
(20 text PDFs).

## Known limits
- Invoice dates use four printed formats, including `DD/MM/YYYY`. When the day is 12 or less that format is
  ambiguous by design: it tests the pipeline's date normalisation, so expect some date misses there.
- The degraded copies are mild (2-4° skew, slight blur, JPEG quality 25-35). They measure robustness, not
  worst-case scans.
- Rendered files depend on the Pillow/FreeType and reportlab versions, so regenerating on another machine
  can change image bytes. The committed files are canonical: cassettes are keyed on them, so don't
  regenerate binaries without re-recording the extraction cassettes.

## Spot checks
Rendered files opened and checked by eye against their ground truth (2026-10-03):
- `invoices/inv-u1-09-clean.png`: PO invoice; vendor, PO number, lines, subtotal, tax and total match.
- `invoices/inv-u1-18-clean.png` rendered with all three degradations (the committed copy is
  `inv-u1-18-jpeg.jpg`): injection invoice; text legible in every variant, and the gold ignores the
  injected note.
