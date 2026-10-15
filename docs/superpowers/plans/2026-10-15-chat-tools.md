# Chat Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Ask Lumen, attach an invoice and ask about it, save it with one approval, get live exchange rates, and see one follow-up suggestion per answer.

**Architecture:** The chat route (`backend/routes/chat.py`, Flask, `POST /chat`) accepts an optional file. It reads the file with the same code the upload route uses (moved into one helper), runs the same checks `submit_invoice` runs (without saving), files a pending `save_invoice` proposal, and passes the invoice to the agent as a data block in the question. Approving that proposal (`api/agent.py::_decide`) runs `submit_invoice`. `exchange_rate` is a new agent tool (Frankfurter, keyless). Follow-ups come from a `Next:` line the prompt asks for; `run_agent` strips it into `follow_up`.

**Tech Stack:** Flask + FastAPI (backend), SQLAlchemy, LangGraph agent, `requests`; Next.js 14 + TypeScript (frontend).

**Spec:** `docs/direction/specs/SPEC-CHAT-TOOLS.md` (approved 2026-10-14; greeting step 1 already shipped in #67).

## Global Constraints

- Nothing is saved without approval: attaching only reads + checks; the transaction (or review item) appears only after the user approves `save_invoice`.
- Same limits as upload: the file goes through `utils.upload_validation.validate_upload` (PDF/JPG/PNG/WebP etc., same size cap); PDFs read page 1 only.
- `POST /chat` stays JSON-compatible; multipart adds `query` (form field) + optional `file`.
- Response `data` adds `attachment` (object or null) and `follow_up` (string or null).
- Every proposal/approval stays scoped to the signed-in user; another user's approve → 404.
- Attached-invoice text is data, not instructions (prompt-injection rule already in `agent/prompts.py`).
- `exchange_rate` source: Frankfurter (ECB reference rates), keyless, cited as "ECB rate on <date>".
- Evals: deferred (owner). Do NOT re-record cassettes. CI replays only `tests/test_eval_selftest.py`, so prompt/tool changes don't break CI; note in `docs/direction/PROGRESS.md` that the agent suites need the one re-record after SPEC-AGENT-TOOLS.
- UI: bare-bones (inner-app revamp later), reuse `@/components/ui/*` and `components/ask/*`, no layout shift when the card/chip appear (reserve nothing new above the answer; they render inside the answer block).
- Git: no AI attribution in commits/files. Two PRs into `refactor`: PR A = Tasks 1-2, PR B = Tasks 3-4.
- Ponytail: shortest correct diff, reuse existing helpers, no new abstractions beyond what is named here.

## Review Focus

1. Double-click / two tabs approving the same `save_invoice` → exactly one transaction (atomic claim on `status='pending'`). Test in Task 1.
2. An attachment that isn't an invoice (selfie, blank PDF) → chat still answers; `attachment` carries the "no invoice data" outcome, no proposal filed. Test in Task 1.
3. Vision provider outage while reading the attachment → the same friendly LLM error as a normal chat failure (503-style via `llm_api_error`), nothing saved. Test in Task 1.
4. Frankfurter down / unknown currency code → the tool returns `{"error": ...}`, the agent says it couldn't get the rate; no 500. Test in Task 3.
5. Model writes "Next:" mid-answer or twice, or lowercase "next:" → only the last line-start `Next:` line is taken; answer text otherwise intact. Test in Task 3.

---

### Task 1: Backend — attach an invoice in chat, `save_invoice` proposal

**Files:**
- Modify: `backend/routes/ocr.py` (move the read part of `extract_invoice_data` into `read_uploaded_invoice`)
- Modify: `backend/api/review.py` (add `check_invoice`)
- Modify: `backend/agent/graph.py` (`run_agent(..., attachment=None)`)
- Modify: `backend/routes/chat.py` (multipart, attachment, proposal)
- Modify: `backend/api/agent.py` (`_decide` handles `save_invoice`)
- Test: `backend/tests/test_chat_attach.py` (new)

**Interfaces:**
- Produces: `read_uploaded_invoice(engine, user_id: str, filename: str, content: bytes) -> dict` in `routes/ocr.py`; raises `UploadError(message: str, status: int, code: str)` (also in `routes/ocr.py`) for bad file / unreadable PDF/image / no invoice data; lets `LLMError` propagate. Returned dict = the reader's invoice dict plus `source_file`, `file_type`, `file_key` (original kept via `utils.files.keep`).
- Produces: `check_invoice(engine, user_id: str, invoice: dict) -> dict` in `api/review.py` → `{"flags": [...], "confidence": "high"|"medium"|"low"}`, same checks as `submit_invoice`, writes nothing.
- Produces: chat response `data.attachment` = `{"invoice": {...}, "flags": [...], "confidence": str, "proposal_id": str}` or `{"error": str, "code": str}` when the file had no invoice / couldn't be read; `null` without a file.
- Produces: Proposal row `type="save_invoice"`, `target=<invoice_number or vendor_name or "attached invoice">`, `payload=json(invoice incl. file_key)`, `risk="low"`, `reason="Save the invoice you attached in chat."`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_chat_attach.py`. Reuse the fixtures/patterns of `tests/test_ask_lumen.py` (how it builds the app, signs a user in, and fakes the agent's `complete`) — read it first and copy its setup. Mock the vision call by monkeypatching `api.review.read_with_feedback` (what `read_uploaded_invoice` calls) to return a fixed invoice dict like:

```python
INVOICE = {"vendor_name": "Acme Paper", "invoice_number": "AP-1001", "date": "2026-10-01", "currency": "INR",
           "subtotal": 1000.0, "tax_amount": 180.0, "total_amount": 1180.0, "items": [
               {"item_name": "A4 paper", "quantity": 10, "unit_price": 100.0, "total_price": 1000.0}]}
```

Tests (one function each):
1. `test_chat_with_attachment_returns_card_and_files_proposal` — multipart `POST /chat` with `query="Is this a fair price?"` and a small PNG (`b"\x89PNG\r\n\x1a\n" + bytes(64)` is NOT enough for PIL; generate a 1×1 PNG with PIL `Image.new("RGB",(1,1))` into BytesIO). Assert 200, `data.attachment.invoice.vendor_name == "Acme Paper"`, `data.attachment.proposal_id` set, a `Proposal(type="save_invoice", status="pending")` exists for the user, and **no** `Transaction` exists yet. Assert the faked `complete` received a user message containing `"Acme Paper"` (the invoice reached the agent).
2. `test_approve_save_invoice_records_once` — after test 1's flow, call `api.agent._decide(proposal_id, user_id, "approved", deps)` twice (second → `HTTPException` 409); exactly one `Transaction` with `invoice_number == "AP-1001"` (or one ReviewItem if checks flag it — assert `transactions + flagged review items == 1`).
3. `test_other_user_cannot_approve` — `_decide(proposal_id, "someone-else", "approved", deps)` → `HTTPException` 404.
4. `test_attachment_without_invoice_data_still_answers` — mocked reader returns `{"vendor_name": None, "total_amount": None, ...}` → 200, `data.attachment.code == "no_invoice_data"`, no proposal.
5. `test_attachment_llm_outage_is_friendly_error` — mocked reader raises `LLMError(LLMError.UNAVAILABLE, "down")` (check the constructor in `utils/llm.py`) → the same status/message `routes/chat.py` returns for an agent LLM failure; no proposal, no transaction.
6. `test_json_chat_unchanged` — JSON `POST /chat` without a file → 200, `data.attachment is None`.

- [ ] **Step 2: Run to verify they fail**

Run (from `backend/`): `OPENROUTER_API_KEY=test-key SECRET_KEY=test-secret-key-for-ci-only SUPABASE_URL=https://example.supabase.co python -m pytest -q -p no:cacheprovider tests/test_chat_attach.py`
Expected: FAIL (no multipart handling / no `attachment` key).

- [ ] **Step 3: Move the read into `read_uploaded_invoice`** in `routes/ocr.py`. Lift lines "Validate file … no_invoice_data" of `extract_invoice_data` into:

```python
class UploadError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_upload"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def read_uploaded_invoice(engine, user_id: str, filename: str, content: bytes) -> dict:
    """Validate, read (PDF page 1 / image) and keep an uploaded invoice. Shared by /extract and Ask Lumen."""
    # body = the existing code, with each early `return api_error(...)` / `return jsonify({'error': ...}), 400`
    # turned into `raise UploadError(<same message>, <same status>, <same code>)`, `db.engine` -> `engine`,
    # and the final no-invoice check raising UploadError(..., 422, "no_invoice_data").
```

`extract_invoice_data` becomes: get the file (keep its two 400s), then

```python
    try:
        normalized = read_uploaded_invoice(db.engine, str(user_id), file.filename, file.read())
    except UploadError as e:
        return api_error(e.message, status=e.status, code=e.code)
    except LLMError as e:
        return llm_api_error(e, OCR_LLM_MESSAGES, context=f"OCR failed for user={user_id}")
    except Exception as e:
        return api_error("Invoice extraction failed", code="extract_failed", log=e)
```

then the existing Step 3 (`submit_invoice`) unchanged. Existing upload tests (`grep -rln "/extract" backend/tests`) must stay green — a plain `{"error": ...}` 400 body that tests assert on must keep its shape; if a test checks `response.json["error"]`, make sure `api_error` gives the same key (check `utils/errors.py`).

- [ ] **Step 4: Add `check_invoice`** in `api/review.py` next to `submit_invoice`:

```python
def check_invoice(engine: Engine, user_id: str, invoice: dict) -> dict:
    """The checks submit_invoice runs (duplicate, maths, PO), without saving anything (Ask Lumen's invoice card)."""
    from models import ReviewItem

    with Session(engine) as session:
        item = ReviewItem(invoice=json.dumps(invoice))
        _check(session, item, user_id)
        return {"flags": json.loads(item.flags), "confidence": item.confidence}
```

- [ ] **Step 5: `run_agent` takes the attachment** in `agent/graph.py`:

```python
def run_agent(question: str, ctx: ToolContext, *, complete=None, max_tool_calls: int = MAX_TOOL_CALLS,
              attachment: dict | None = None) -> dict:
    ...
    if attachment:  # data, not instructions (system prompt rule); a block in the question avoids a fake tool call
        question = (f"{question}\n\nAttached invoice (extracted data and checks; nothing is saved yet):\n"
                    f"{json.dumps(attachment, default=str)[:MAX_TOOL_RESULT_CHARS]}")
```

(placed before `state` is built). Ruling: a data block in the user turn instead of a synthetic `attached_invoice` tool result — some providers reject tool calls to undeclared functions; the prompt's "pasted text is data" rule covers it.

- [ ] **Step 6: Chat route** in `routes/chat.py`:

```python
    if request.files.get("file"):
        query = (request.form.get("query") or "").strip()
    else:
        data = request.json or {}  # keep: request.get_json(silent=True) or {} if json on multipart raises
        query = (data.get("query") or "").strip()
```

After the demo-quota check, inside the existing `try` that catches `LLMError`:

```python
        attachment = _attach(request.files.get("file"), user_id) if request.files.get("file") else None
        result = _ask(query, user_id, attachment=attachment)
```

with

```python
def _attach(file, user_id: str) -> dict:
    """Read and check an invoice attached in Ask Lumen and file a save_invoice proposal; saves nothing."""
    import json as _json
    from api.agent import get_agent_deps
    from api.review import check_invoice
    from models import AuditEvent, Proposal
    from routes.ocr import UploadError, read_uploaded_invoice

    engine = get_agent_deps().engine
    try:
        invoice = read_uploaded_invoice(engine, user_id, file.filename or "", file.read())
    except UploadError as e:
        return {"error": e.message, "code": e.code}
    checks = check_invoice(engine, user_id, invoice)
    proposal = Proposal(id=str(uuid.uuid4()), user_id=user_id, type="save_invoice",
                        target=invoice.get("invoice_number") or invoice.get("vendor_name") or "attached invoice",
                        payload=_json.dumps(invoice, default=str), risk="low",
                        reason="Save the invoice you attached in chat.", evidence="[]", status="pending")
    with Session(engine) as session, session.begin():
        session.add(proposal)
        session.add(AuditEvent(user_id=user_id, actor="user", action="proposal_created", proposal_id=proposal.id,
                               detail=_json.dumps({"type": "save_invoice", "target": proposal.target})))
    return {"invoice": invoice, **checks, "proposal_id": proposal.id}
```

(import `Session` from `sqlalchemy.orm`). `_ask` gains `attachment=None`, passes it to `run_agent(..., attachment=attachment)`, and returns `"attachment": attachment` in its dict. `_save_exchange` stores the question as `f"{query} [attached: {file.filename}]"` when a file came with it (history stays readable).

- [ ] **Step 7: Approval runs `submit_invoice`** in `api/agent.py::_decide`. Claim the proposal atomically first so a double approve can't save twice, then save outside the claim transaction:

```python
    if decision == "approved":
        with Session(deps.engine) as session, session.begin():
            p = session.scalar(select(Proposal).where(Proposal.id == proposal_id, Proposal.user_id == user_id))
            if p is not None and p.type == "save_invoice":
                claimed = session.execute(update(Proposal).where(
                    Proposal.id == proposal_id, Proposal.user_id == user_id, Proposal.status == "pending")
                    .values(status="saving")).rowcount
                if not claimed:
                    raise HTTPException(409, f"Proposal is already {p.status}")
        # after this block, for a claimed save_invoice:
        #   from api.review import submit_invoice
        #   try: item = submit_invoice(deps.engine, user_id, json.loads(payload))
        #   except Exception: set status back to "pending" in a new session, re-raise
        #   then set status="approved", decided_at, AuditEvent(detail={"applied": {"review_item": item["id"],
        #   "status": item["status"], "transaction_id": item.get("transaction_id")}}) and return the usual shape.
```

Write it as plain code following the existing `_decide` style (one helper `_save_invoice(proposal_id, user_id, deps)` called from `_decide` when the type is `save_invoice`; all other types keep today's path untouched). `Proposal.status` is `String(20)`, so `"saving"` needs no migration; update its comment to list it.

- [ ] **Step 8: Run the new tests + full suite**

Run: the Step 2 command, then the full suite `... python -m pytest -q -p no:cacheprovider` (baseline after email ingestion: 730+ passed).
Expected: all pass.

- [ ] **Step 9: Commit** — `git add` the files above; `git commit -m "Ask Lumen: attach an invoice, see its checks, save it with one approval"`.

---

### Task 2: Frontend — paperclip, invoice card, Save button

**Files:**
- Modify: `frontend/src/lib/api/client.ts` (`chatApi.sendMessage(query, file?)`, `ChatAnswer.attachment`)
- Modify: `frontend/src/components/ask/prompt-bar.tsx` (paperclip + chosen-file chip)
- Create: `frontend/src/components/ask/invoice-card.tsx`
- Modify: `frontend/src/components/ask/answer.tsx` (render the card above the answer text)
- Modify: the page/component that calls `chatApi.sendMessage` (find with `grep -rn "chatApi.sendMessage" frontend/src`)

**Interfaces:**
- Consumes: Task 1 response `data.attachment` (shape above); approve via the existing proposals client (`grep -n "approve" frontend/src/lib/api/client.ts` — the agent-proposals API under `/api/agent`).
- Produces: `ChatAnswer.attachment?: ChatAttachment | null` with
```ts
export interface ChatAttachment {
	invoice?: { vendor_name: string | null; invoice_number: string | null; date: string | null;
		currency: string | null; total_amount: number | null; items?: { item_name: string; total_price: number | null }[] };
	flags?: { rule: string; severity: "note" | "warn" | "fail"; detail: string }[];
	confidence?: string;
	proposal_id?: string;
	error?: string;
	code?: string;
}
```
(check the real flag fields in `backend/extract/validate.py::Flag` and match them).

- [ ] **Step 1: Client** — `sendMessage(query: string, file?: File)`: when `file` is set, build `FormData` (`query`, `file`) and `apiClient.post("/chat", form)` (let the browser set the multipart boundary; don't set Content-Type by hand); else today's JSON post.
- [ ] **Step 2: Prompt bar** — a paperclip icon button (`lucide-react` `Paperclip`, already a dependency) opening a hidden `<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp">`; the chosen file shows as a small removable chip inside the bar (fixed height — no layout shift); sending passes the file and clears it. Keep the existing mic placeholder.
- [ ] **Step 3: Invoice card** (`invoice-card.tsx`) — vendor, number, date, total with currency, up to 5 line items, each flag's detail, and a **Save to my records** button that approves `proposal_id`; on success the button becomes "Saved" (disabled), on 409 also "Saved"; on other errors show the message. If `attachment.error`, the card shows just that message. Reuse `proposal-card.tsx` styling/patterns.
- [ ] **Step 4: Answer** — render `<InvoiceCard>` above the markdown when `answer.attachment` is present.
- [ ] **Step 5: Checks** — from `frontend/`: `npx tsc --noEmit -p .`, `npx next lint`, `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000 NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npm run build`. All clean.
- [ ] **Step 6: Docs + commit** — `docs/CODEBASE-GUIDE.md` (Ask Lumen section: attach flow, `save_invoice`), `docs/direction/PROGRESS.md`, `TODO.md` (tick "attach an invoice in chat"). `git commit -m "Ask Lumen: paperclip, invoice card and Save button"`.

---

### Task 3: Backend — `exchange_rate` tool and follow-up suggestions

**Files:**
- Modify: `backend/agent/tools.py` (new tool)
- Modify: `backend/agent/prompts.py` (tool line + `Next:` rule)
- Modify: `backend/agent/graph.py` (strip `Next:` → `follow_up`; `_summary` for the tool)
- Modify: `backend/routes/chat.py` (`follow_up` in the response)
- Test: `backend/tests/test_agent_tools.py` (or the existing tools test file — `ls backend/tests | grep -i tool`), `backend/tests/test_agent_graph.py`

**Interfaces:**
- Produces: tool `exchange_rate(base: str, quote: str, date: str | None)` → `{"base": "USD", "quote": "INR", "rate": 83.1, "date": "2026-10-13", "source": "ECB reference rate (Frankfurter)"}` or `{"error": str}`.
- Produces: `split_follow_up(text: str) -> tuple[str, str | None]` in `agent/graph.py`; `run_agent` returns `follow_up`; chat `data.follow_up`.

- [ ] **Step 1: Failing tests**

```python
def test_exchange_rate_ok(monkeypatch):
    from agent import tools
    class R:
        status_code = 200
        def json(self): return {"amount": 1.0, "base": "USD", "date": "2026-10-13", "rates": {"INR": 83.1}}
        def raise_for_status(self): pass
    monkeypatch.setattr(tools.requests, "get", lambda *a, **k: R())
    out = tools.run_tool(ctx, "exchange_rate", {"base": "usd", "quote": "inr"})  # ctx: reuse the file's fixture
    assert out == {"base": "USD", "quote": "INR", "rate": 83.1, "date": "2026-10-13",
                   "source": "ECB reference rate (Frankfurter)"}

def test_exchange_rate_service_down(monkeypatch):
    from agent import tools
    def boom(*a, **k): raise tools.requests.RequestException("down")
    monkeypatch.setattr(tools.requests, "get", boom)
    assert "error" in tools.run_tool(ctx, "exchange_rate", {"base": "USD", "quote": "INR"})

def test_exchange_rate_bad_code_rejected():
    from agent import tools
    assert "error" in tools.run_tool(ctx, "exchange_rate", {"base": "DOLLARS", "quote": "INR"})

def test_split_follow_up():
    from agent.graph import split_follow_up
    assert split_follow_up("You spent 500.\nNext: Which vendor was it?") == ("You spent 500.", "Which vendor was it?")
    assert split_follow_up("No suggestion here.") == ("No suggestion here.", None)
    assert split_follow_up("Next: a\nmore\nnext:  b ") == ("Next: a\nmore", "b")   # last line-start one wins
    assert split_follow_up("We do this next: tomorrow.") == ("We do this next: tomorrow.", None)  # not at line start
```

Plus in `test_agent_graph.py`: a fake `complete` returning `"Answer.\nNext: Follow?"` → `run_agent(...)["answer"] == "Answer."` and `["follow_up"] == "Follow?"`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Tool** in `agent/tools.py` (add `import requests` at top):

```python
class ExchangeRateArgs(BaseModel):
    base: str = Field(description="ISO 4217 code to convert from, e.g. USD.")
    quote: str = Field(description="ISO 4217 code to convert to, e.g. INR.")
    date: str | None = Field(default=None, description="YYYY-MM-DD for a past rate; omit for the latest.")


FRANKFURTER = "https://api.frankfurter.dev/v1"  # ECB reference rates, keyless


def _exchange_rate(ctx: ToolContext, args: ExchangeRateArgs) -> dict:
    base, quote = args.base.strip().upper(), args.quote.strip().upper()
    if not (re.fullmatch(r"[A-Z]{3}", base) and re.fullmatch(r"[A-Z]{3}", quote)):
        return {"error": "Use 3-letter currency codes like USD or INR."}
    if args.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        return {"error": "Use a YYYY-MM-DD date."}
    try:
        r = requests.get(f"{FRANKFURTER}/{args.date or 'latest'}", params={"base": base, "symbols": quote}, timeout=8)
        r.raise_for_status()
        body = r.json()
        return {"base": base, "quote": quote, "rate": body["rates"][quote], "date": body["date"],
                "source": "ECB reference rate (Frankfurter)"}
    except (requests.RequestException, KeyError, ValueError) as e:
        return {"error": f"Couldn't get the {base}/{quote} rate: {e}"[:200]}
```

Before writing, confirm the live API shape once: `curl -s "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR"` — if that host fails, try `https://api.frankfurter.app/latest?from=USD&to=INR` and use whichever works (keep the test's reply shape in sync). Register: `Tool("exchange_rate", "Currency exchange rate (ECB reference rate) for a date or the latest; use to compare or convert amounts in different currencies.", ExchangeRateArgs, _exchange_rate)`. Check `import re` exists in tools.py.

- [ ] **Step 4: Prompt** in `agent/prompts.py` — add under Tools: `- Converting or comparing currencies -> exchange_rate (cite it as "ECB rate on <date>").` and under Rules: `- End with one short follow-up question the user is likely to ask next, on its own last line, starting "Next: ".`
- [ ] **Step 5: Follow-up split** in `agent/graph.py`:

```python
_NEXT = re.compile(r"^[ \t]*next:[ \t]*(.+?)[ \t]*$", re.IGNORECASE | re.MULTILINE)


def split_follow_up(text: str) -> tuple[str, str | None]:
    """The prompt asks for a last line "Next: <question>"; return (answer without it, the question or None)."""
    matches = list(_NEXT.finditer(text or ""))
    if not matches:
        return text, None
    m = matches[-1]
    return (text[:m.start()] + text[m.end():]).strip(), m.group(1)
```

In `run_agent`: `answer, follow_up = split_follow_up(final["answer"] or "")` before citations are computed; add `"follow_up": follow_up` to the returned dict. `_summary`: `if name == "exchange_rate": return f"{result.get('base')}/{result.get('quote')} {result.get('rate')}"` (after the error branch).
- [ ] **Step 6: Chat** — `_ask` returns `"follow_up": out["follow_up"]`.
- [ ] **Step 7: Run new tests + full suite**, expect all pass (fix any test that asserted the exact system prompt text by updating its expectation, not by weakening it).
- [ ] **Step 8: Commit** — `git commit -m "Ask Lumen: exchange rates (ECB) and a follow-up suggestion per answer"`.

---

### Task 4: Frontend — follow-up chip, docs

**Files:**
- Modify: `frontend/src/lib/api/client.ts` (`ChatAnswer.follow_up?: string | null`)
- Modify: `frontend/src/components/ask/answer.tsx` (chip under the answer)
- Modify: the chat page component (chip click sends the question)
- Modify: `docs/CODEBASE-GUIDE.md`, `docs/direction/PROGRESS.md`, `TODO.md`

- [ ] **Step 1:** Render `answer.follow_up` as one small button-chip under the answer (reuse the suggestion-chip styling the empty chat already uses — find it with `grep -rn "getSuggestions" frontend/src`). Click → sends it as a new question (same handler the suggestion chips use). Only on the latest answer.
- [ ] **Step 2:** Checks: `npx tsc --noEmit -p .`, `npx next lint`, the build command from Task 2. All clean.
- [ ] **Step 3:** Docs: CODEBASE-GUIDE (agent tools list gains `exchange_rate`; follow-ups), PROGRESS (SPEC-CHAT-TOOLS done; agent eval suites await the one re-record after SPEC-AGENT-TOOLS), TODO (tick exchange rate + follow-ups).
- [ ] **Step 4:** Commit `"Ask Lumen: follow-up chip, docs"`.
