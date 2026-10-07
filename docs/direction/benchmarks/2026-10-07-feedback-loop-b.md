# 2026-10-07: feedback loop B (warnings adapt to each user)

`python -m evals.run --tier groq --suite feedback` (no LLM). 6 months × 2 users × 10 invoices = 120 invoices through
the real review path (`api/review.py`), with and without loop B. Per user and month: 6 ordinary invoices, one from a
vendor that prints its own reference in the PO field (`unknown_po`), one from a vendor with no currency on its
invoices (`no_currency`), one from a brand-new vendor (`unknown_vendor`), and one planted fault (wrong total,
duplicate, future date, injected instructions), which from month 4 lands on the two quirky vendors. A simulated
reviewer approves exactly the clean invoices, unchanged, and rejects the faults.

| | Without loop B | Loop B as approved (any rejection resets) | Variant: only an *unexplained* rejection resets |
|---|---|---|---|
| Sent to a person (of 120) | 48 | 44 | **36** (−25%) |
| False alarms (clean ones sent to a person) | 36 | 32 | **24** (−33%) |
| Missed faults (hard gate 0) | 0 | **0** | **0** |
| Per month, sent to a person | 8 8 8 8 8 8 | 8 8 8 **5** 7 8 | 8 8 8 **4 4 4** |

**What the numbers say.** Loop B works (month 4 drops as soon as three approvals exist), but under the approved
reset rule a single rejected *fault* from a quirky vendor (rejected for its wrong total, say) also wipes what was
learned about that vendor's harmless warnings, so the load creeps back. The variant ignores rejections that a
failure already explains: months 4-6 halve (8 → 4), false alarms fall from 6 to 2 a month (the 2 left are genuinely
new vendors, which should be checked), and every planted fault, including those on the silenced vendors, still
reaches a person. The variant changes the approved spec, so it waits for the owner.

Caveats: a synthetic stream designed to contain recurring harmless warnings; the reviewer is perfect; small n.
