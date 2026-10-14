# SPEC-CHAT-TOOLS: invoices in chat, live facts, follow-ups, a personal greeting

Status: **APPROVED (owner, 2026-10-14)**, with one change: **no eval re-recording yet** — first settle the full tool
catalogue (SPEC-AGENT-TOOLS) so the suites are recorded once. Owner asks (2026-10-14): upload an invoice in Ask Lumen, get insights on it and
save it from the chat; tool calling for outside facts (exchange rates and similar); a follow-up suggestion after each
answer; greet the user by name.

## Where we are
- The agent (`agent/graph.py`, `agent/tools.py`) already calls tools: `get_schema`, `lookup_vendors`, `run_sql`,
  `search_documents` (hybrid RAG), `get_invoice`, `get_anomalies`, `forecast`, `propose_action` (you approve; only
  `update_category` changes data today).
- The prompt bar is text only (the mic is a placeholder). Invoice extraction exists outside chat
  (`routes/ocr.py` → `extract.read.read_invoice` → `submit_invoice`).
- The prompt and tool schemas are part of every recorded eval request, so **any change here means re-recording the
  agent suites** (about one day of Groq free quota, or minutes with credits).

## Design
1. **Attach an invoice in chat.** A paperclip in the prompt bar (PDF/JPG/PNG/WebP, same limits as upload). The file
   goes with the question to `POST /api/v1/chat` (multipart). The server extracts it with `read_invoice` (one vision
   call), keeps the original (`utils/files.keep`) and adds the extracted invoice to the agent's context as a tool
   result (`attached_invoice`: vendor, number, date, currency, line items, totals, plus the checks from
   `extract.validate`: duplicate, maths, PO). The agent answers questions about it ("is this a fair price?", "have I
   paid this vendor more before?") using its normal tools, e.g. `run_sql` over past invoices from the same vendor.
   The chat shows a compact invoice card above the answer.
2. **Save it from the chat.** New proposal type `save_invoice` (target = the attachment): the agent proposes it, or
   the card has a **Save to my records** button; approving runs the existing `submit_invoice` (so the same checks and
   review queue apply). Nothing is saved without approval.
3. **Outside facts, one tool at a time:**
   - `exchange_rate(base, quote, date?)` from the free, keyless Frankfurter API (ECB reference rates), cited like
     other evidence ("ECB rate on 2026-10-13"). It also lets the agent show totals in one currency.
   - ponytail: no general web search yet; add tools when a real question needs them (each is a function plus a
     schema line).
4. **Follow-ups.** The prompt asks the agent to end with one short follow-up question the user is likely to ask next,
   on its own line after `Next:`; the server strips it from the answer and returns it as `follow_up`, shown as a
   chip that sends it in one click.
5. **Greeting by name.** The empty chat says "Good evening, Asha." using the onboarding name (`useProfile`), like the
   dashboard. Not part of the prompt; ships first (no eval impact).
6. **Evals:** deferred (owner). The recorded agent suites will fail to replay once the prompt/tools change; CI runs
   `pytest -m eval` only on replay, so those suites are marked skipped with a pointer to SPEC-AGENT-TOOLS until the one
   re-record. The tools here join that catalogue.

## Data and API
- `proposals.type` gains `save_invoice` (payload = the extracted invoice + file key); no new tables.
- `POST /api/v1/chat` accepts multipart (`query`, optional `file`); JSON stays supported.
- Response adds `attachment` (extracted invoice + checks) and `follow_up` (string or null).

## Testing
- Unit: `exchange_rate` with a mocked HTTP reply and an error reply; follow-up parsing (present, absent, malformed);
  `save_invoice` approval calls `submit_invoice` and is idempotent.
- API: chat with an attached invoice (vision call mocked) → card data + answer + optional proposal; approve → a
  transaction (or review item); another user can't approve it.
- Evals: the re-recorded suites plus the new cases above.
- Browser: attach an invoice, ask about it, save it, see it on the dashboard; greeting shows your first name.

## Order (one PR each)
1. Greeting by name (tiny).
2. Attach + context + card + `save_invoice`.
3. `exchange_rate` + follow-ups (evals deferred).
