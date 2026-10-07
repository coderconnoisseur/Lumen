# SPEC-FEEDBACK: reviewer decisions feed back into the next invoice

Status: **DRAFT for owner review** (one-pager). Builds on SPEC-EXTRACT (rules, confidence, review queue) and needs
EXT-01 (structured vision extraction) for loop A. No model training: the model never changes; what it is shown and
which warnings are raised do.

## Goal
Every approve, edit and reject in the review queue makes the next similar invoice need less human work, without
ever letting a real fault through. Each claim is measured on a replayable eval, so the resume line is a number:
"repeat-vendor field errors −X%, review load −Y%, 0 missed faults".

## Loop A: corrections become examples (needs EXT-01)
- When a reviewer edits a field before approving, we keep what the model read and what the person corrected
  (`review_items.extracted` = the model's original output; `invoice` = the approved version).
- The next extraction for the **same user and vendor** adds up to 3 recent corrections to the prompt as worked
  examples ("on invoices from City Power Ltd, the total is the 'Amount payable' line, not 'Current charges'").
  Retrieved per vendor by exact name, newest first; nothing crosses users.
- Corrections are data, never instructions: they're rendered as field/value pairs, not free text, so an injected
  invoice can't plant an "example".

## Loop B: warnings adapt to each user (no LLM)
- Only **warnings** can adapt (`unknown_vendor`, `unknown_po`, `no_currency`). A (user, vendor, rule) warning that a
  person approved **unchanged 3 times in a row**, with no rejection, stops being raised; one rejection of an invoice
  from that vendor brings it back.
- **Failures never adapt**: total mismatch, duplicate, bad date, PO mismatch and injection are always flagged.
- Derived from `review_items` history at check time (no new table); every suppression is visible in the item's
  flags as `suppressed: [rule]`, so a reviewer can see what was skipped and why.

## Evaluation
- **Loop B (`feedback` suite, no LLM):** a generated stream of ~6 months of incoming invoices per user with planted
  faults and new vendors; a simulated reviewer approves exactly the invoices without a planted fault. Report per
  month: review load (share sent to a human), false alarms, and **missed faults (hard gate = 0)**; with vs without
  adaptation.
- **Loop A (extends the `extraction` suite):** invoices from repeat vendors, extracted without and then with the
  stored corrections from earlier invoices of that vendor; field F1 on the later invoices, paired per case. Needs
  OpenRouter vision quota (recorded once, replayed in CI).

## Acceptance criteria
1. A failure rule is never suppressed (unit test per rule) and missed faults stay 0 on the stream.
2. Suppression and corrections are per user; tests prove one user's feedback never affects another's.
3. Every suppression and every correction used is visible (flags / audit detail).
4. Both loops are measured with vs without, with counts and CIs, in a dated snapshot.

## Open questions for the owner
1. Threshold for loop B: 3 unchanged approvals (recommended) or more?
2. Should rejected invoices also teach (e.g. reject reason "not ours" → always flag that vendor)? Recommendation:
   not in v1; rejections only reset adaptation.
