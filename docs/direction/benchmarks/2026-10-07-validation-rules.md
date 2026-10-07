# 2026-10-07: invoice validation rules on the gold invoices (EXT-02)

`python -m evals.run --tier groq --suite validation` (no LLM; the tier is ignored). Rules in
`backend/extract/validate.py`, run on each labelled invoice *as printed* (`invoices.jsonl`) against its user's
history in the synthetic world (known vendors, stored invoice numbers, purchase orders, today = AS_OF).

| | Dev (28 invoices) | Test (12) |
|---|---|---|
| Planted faults caught (5 types) | **11/11** | **5/5** |
| Precision per rule | 1.0 for every rule that fired | 1.0 |
| False flags on clean invoices | **0/17** (CI 0.00-0.18) | 0/7 |
| Clean invoices auto-approved (confidence high) | 17/17 | 7/7 |

**Read this as a ceiling, not a result.** The rules were written knowing the five planted fault types, and the
input is the gold data, so 100% is what a correct implementation should score here; the test locks that in
(`tests/test_extract_validate.py`). The honest number comes with EXT-01: the same rules on what the vision model
actually read from the (clean and degraded) images, where a misread total or date can raise false flags or hide a
fault. Small n: one bad-date and one injection invoice per split, so per-type CIs are wide.
