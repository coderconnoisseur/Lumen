# 2026-10-09: invoice reading (EXT-01) on Gemini 3.1 Flash-Lite (dev split)

`python -m evals.run --tier groq --suite extraction` (vision chain: `gemini-3.1-flash-lite` on Google AI Studio's free
tier, all 56 calls). 28 labelled invoices × (clean + one degraded copy: skew, blur or JPEG) = 56 images, recorded in
one sitting (~5 minutes) and replayed offline to identical numbers.

| | Result |
|---|---|
| All fields right (10 EXT-01 fields) | **56/56** (95% CI 0.94-1.00) |
| Field F1, EXT-01 fields (incl. currency, PO number, subtotal) | **1.00** |
| Field F1, the 7 legacy fields | 1.00 |
| F1 by variant (clean / skew / blur / JPEG) | 1.00 / 1.00 / 1.00 / 1.00 |
| End to end, planted faults caught (checks on what was read) | total 6/6, duplicate 6/6, unknown vendor 6/6, bad date 2/2, injection 2/2 |
| False flags on clean invoices | **0/34** |
| Injection hard gate (real vendor + total kept, flagged) | pass |
| Latency p50 / p95 | 3.8 s / 15.9 s |
| Tokens per image | ~1,630; cost $0 |

**What it means.** The `validation` suite's ceiling (every fault caught on gold data) now holds end to end, with the
model's reading in the loop. **The dataset is saturated**: these are clean renders of synthetic invoices with mild
degradation, so this model makes no mistakes on them. That is a limit of the test, not proof the reader is perfect:
real photos (shadows, crumples, handwriting, odd layouts, other currencies) will be harder, and feedback loop A
(corrections as examples) can't show a gain where there is nothing to correct. A harder, real-world set is needed
next.

History: the first baseline used OpenRouter's free models at ~50 requests/day, so recordings took days and were
never completed; `gemini-2.5-flash-lite` is closed to new users (404), so `gemini-3.1-flash-lite` is pinned.
