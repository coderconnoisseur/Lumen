# SPEC-UX: evidence-first screens for the demo

Status: **DRAFT for owner review** (one-pager). Covers roadmap **UX-01 … UX-05**. Each item ships with its backend
piece; polish comes last and is on the cut line.

## Goal
Make the 90-second demo (IDEA.md section 2) obvious on screen: every AI answer shows where it came from, every
doubtful invoice is visible and actionable, and the measured quality is one click away.

## Screens
| Item | What | Ships with |
|---|---|---|
| **UX-01 Evidence-first chat** | Citation chips under each answer (click → the passage, or the validated SQL and its rows); a collapsible "show your work" panel listing the agent's tool steps with timings; clear "I couldn't find this" states. | SPEC-AGENT `/api/agent/ask` |
| **UX-02 Review queue** | A table of flagged invoices with their reasons (total mismatch, duplicate, unknown vendor, bad date, possible injection), the extracted fields next to the invoice image, and approve / edit / reject. | SPEC-EXTRACT review API |
| **UX-03 Trust page** | The README eval tables rendered in the app: per-suite results with counts, CIs, model names and the retrieval ablation; links to the methodology (`LABELLING.md`). Read-only, generated from the committed release results. | `evals.report` |
| **UX-04 Documents** | Already shipped minimally (upload, list, delete, ask with sources); add doc-type filters and per-document chunk preview. | SPEC-RAG |
| **UX-05 Polish** (cut line) | Upload progress, empty states, the white flash and remount issues already noted in `TODO.md`, mobile layout. | last |

## Principles
- Show evidence before prose: sources and SQL are first-class, not tooltips.
- Abstaining is a designed state, not an error toast.
- No new design system; reuse the existing components and `DashboardShell`.

## Acceptance criteria
1. In the demo, every answer has at least one clickable source or an explicit "no evidence" state.
2. A planted bad invoice goes from upload to the review queue to approve/reject without leaving the UI.
3. The Trust page numbers match `README.md` exactly (same generator).
