# UI Revamp Phase 4 (Ask Lumen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ask Lumen a proper multi-conversation assistant:
- real chat threads, with a fresh chat on open, a history list and one-click resume
- an agent that remembers the last few turns of the thread
- an "Ask anything" palette (⌘/Ctrl+K) that hands a question straight to Ask
- the Sky look
- no stray "Next:" in answers

Also close the Phase 4 backlog items.

**Architecture:**
- **Threads.** A new `chat_threads` table, plus a nullable `thread_id` on `chat_messages` added through `_ADDED_COLUMNS`. A user's legacy thread-less messages are folded lazily into one "Earlier chats" thread.
- **Endpoints** live next to the existing Flask chat routes in `routes/chat.py`.
- **Memory.** `run_agent` takes an optional `history` that goes between the system prompt and the new question. With `history=None` (the evals), its behaviour is byte-identical to today.
- **Frontend.** The Ask page gets a thread rail. The palette is a dialog rendered by the sidebar, and Enter does `router.push("/ask?q=…")`.
- **Sky restyle by token remap.** `.bui`'s CSS variables get Sky values whenever the Sky shell is mounted, so the Ask components need no class rewrites. Phase 0's dark restatement for `.bui` is removed.

**Tech Stack:** Flask + SQLAlchemy (chat routes), the LangGraph agent (`agent/graph.py`), pytest, Next.js, Tailwind v4 tokens, Playwright with the `signIn` fixture.

**Spec:** `docs/superpowers/specs/2026-10-20-ui-revamp-design.md` §7 (Ask Lumen, owner-decided: fresh chat + history, real threads, no streaming) and §12 backlog items tagged Phase 4. The owner decided on 2026-10-21: **the agent gets the thread's recent turns as memory.** Builds on `ui-revamp/phase3-home-backend` (PR #94).

## Global Constraints

- **Opening Ask** (`/ask` with no params) starts a **fresh, empty chat**. History is a list on the side, and one click resumes a thread.
- **No streaming** (owner-decided). The handoff shows the existing thinking state (`Thinking` / `WorkTrace`), then the full answer fades in.
- **Memory:** the last **6** messages of the thread go before the new question, each trimmed to **1,500** characters. Evals and any caller that passes no history get exactly the same prompt as today.
- **Evidence-first behaviour stays:** sources, work trace and proposal cards keep working (SPEC-UX).
- **Per-user scoping on every thread query.** Another user's thread id gives 404.
- **Zero layout shift (spec 6.3):** opening the palette, the history rail or a thread must not move other regions. Reuse the Phase 0 shift-test pattern.
- **Motion:** 150–250ms using `@/lib/motion`. The handoff is a fade: the palette closes and the Ask composer and thinking state fade in. A View Transitions morph is optional polish, only where `document.startViewTransition` exists.
- **Git:** no "claude" in branch names and no attribution lines. Open one PR (base `ui-revamp/phase3-home-backend` until #94 merges). Update `docs/CODEBASE-GUIDE.md`, tick spec §12 and add a STORY entry.

## Decisions this plan makes (owner may override)

- **A thread's title** is its first question, trimmed to 60 characters at a word boundary. There is no LLM-written title.
- **"Earlier chats":**
  - The first time a user lists threads and has messages with `thread_id IS NULL`, one thread titled "Earlier chats" is created and those messages are assigned to it.
  - `updated_at` is set to the newest message's time.
  - The fold is idempotent, and runs inside the list endpoint.
- **Endpoints** (Flask, `@require_auth`, rate limits matching the existing chat routes):
  - `GET /chat/threads` returns `{success, threads: [{id, title, updated_at, message_count}]}`, newest first, max 50.
  - `GET /chat/threads/<id>` returns `{success, thread: {...}, messages: [{id, role, content, created_at}]}`, oldest first.
  - `DELETE /chat/threads/<id>` deletes the thread and its messages.
  - `POST /chat` accepts an optional `thread_id` (JSON field or form field). It is missing for a new thread: one is created with a title. The response `data` gains `thread_id`. A posted `thread_id` that isn't the caller's gives 404.
  - The old `GET/DELETE /chat/history` are **removed**, along with their frontend use (`getHistory`, `clearHistory`). Their tests are deleted or updated.
- **"Next:" fix:** the backend `split_follow_up` gets tests for the shapes seen and plausible. Each one that fails gets fixed in the regex. The variants are:
  - a bare trailing "Next:" after a question
  - "**Next:**" alone on a line
  - "Next :"
  - the full-width "Next："
  - "Next -"
  - a trailing "Next:" followed by whitespace or newlines

  The frontend also never renders a final line that is just `next:` (case-insensitive), as belt and braces for history saved before the fix.
- **Suggested questions on a fresh chat:** up to 3 from Home's summary (`homeApi.summary()`, already cached), followed by `chatApi.getSuggestions()`, de-duplicated, max 4. The mapping:
  - duplicate → "Was I charged twice at {vendor}?"
  - spike → "Why is {category} up this month?"
  - price_rise → "Which of my subscriptions went up?"
  - review → "What's waiting for my review?"

  Vendor and category come from the headline: the server adds `subject` to each found item in `ai/home_signals.py`, holding the vendor or category. That's a one-line change per kind, with tests.
- **Palette:** "Ask anything" is a full-width button at the bottom of the sidebar (its `⌘K` hint moves from the Ask nav item to it). Clicking it or pressing ⌘/Ctrl+K anywhere outside text fields opens a centred `Dialog` with one input.
  - Enter navigates to `/ask?q=<encoded>`. Ask reads `q` once, starts a **new** thread, sends it, and then `router.replace("/ask")` so a reload doesn't resend.
  - Shortcut detection uses `e.code === "KeyK"`, a backlog fix.
- **The Sky restyle** happens in `beautiful-ui.css`: `:root:has([data-app-theme="sky"]) .bui { --page: var(--background); --canvas: …; --surface: var(--card); --ink: var(--foreground); … }`. Map every `.bui` token to a Sky equivalent, and keep `--accent` = Sky primary.
  - Then remove the `:where(.bui)` dark-token block from `globals.css` (Phase 0) and its test "dark .bui panels keep readable muted text inside sky".
  - Replace that test with "Ask uses the Sky palette": the `.bui` container background is `#f4f3ef` and muted text is AA on it.
- **Phase 4 backlog:**
  - **(a)** `_decide` claims the proposal with a conditional `update(Proposal).where(id, user_id, status=="pending").values(status=decision)`, like `_save_invoice`. A lost race gives 409.
  - **(b)** The draft dialog handles a 409 on approve with an inline "This draft was replaced. Draft again." instead of a toast, and stops "Approve all".
  - **(c)** Closing the draft dialog reloads the summary too (`HomeData.reload()` replaces `reloadBudget`).
  - **(d)** Ctrl+K uses `e.code`.

## Review Focus

1. **Another user's thread:** `GET` or `DELETE /chat/threads/<id>` and `POST /chat {thread_id}` with someone else's id all give 404, and nothing is written. Test `test_threads_are_per_user`.
2. **Memory leaks across threads:** the agent sees only *this* thread's messages, never another thread's or another user's. Test `test_agent_history_is_this_thread_only`, which captures the `messages` sent to a fake `complete`.
3. **Huge or odd history:** a 50-message thread sends only the last 6, each ≤1,500 characters. A thread with an attachment line still works. Assistant messages are stored without the follow-up chip. Test `test_history_is_trimmed`.
4. **`?q=` handoff resend:** reload `/ask` after a handoff and nothing is sent again. Opening `/ask?q=` with an empty or whitespace `q` sends nothing. e2e `handoff sends once`.
5. **Legacy users:**
  - a user with only old thread-less messages sees exactly one "Earlier chats" thread holding all of them, and calling the list twice doesn't create a second one
  - a brand-new user sees no threads and the fresh-chat suggestions

  Tests `test_legacy_messages_fold_once` and e2e `fresh chat shows suggestions`.

## File map

| File | Change |
|---|---|
| `backend/models/__init__.py` | `class ChatThread` (`chat_threads`: id str36, user_id str36 indexed, title str, created_at, updated_at); `ChatMessage.thread_id` (str36, nullable, indexed) |
| `backend/models/database.py` | `_ADDED_COLUMNS["chat_messages"] = [("thread_id", "VARCHAR(36)")]` |
| `backend/routes/chat.py` | Thread endpoints; `POST /chat` thread handling and history passing; remove `/chat/history` |
| `backend/agent/graph.py` | `run_agent(..., history: list[dict] | None = None)`; `split_follow_up` fixes |
| `backend/ai/home_signals.py` | `subject` on found items |
| `backend/api/agent.py` | Conditional claim in `_decide` |
| `backend/tests/test_chat_threads.py` (new), `test_agent_memory.py` (new), `test_agent_tools.py` (follow-up variants), `test_home_signals.py`, `test_api_budget.py` (race) | Tests |
| `frontend/src/lib/api/client.ts` | `chatApi.threads()`, `thread(id)`, `deleteThread(id)`, `sendMessage(query, file?, threadId?)`; remove `getHistory`/`clearHistory`; `FoundItem.subject` |
| `frontend/src/app/(app)/ask/chatbotContent.tsx` | Thread state, fresh chat, `?q=`, suggestions, rail; strip the trailing bare "Next:" |
| `frontend/src/app/(app)/ask/thread-rail.tsx` (new) | History list (desktop rail; `Sheet` below `lg`) |
| `frontend/src/components/ask-palette.tsx` (new) | ⌘K dialog |
| `frontend/src/components/app-sidebar.tsx` | "Ask anything" button, `e.code`, palette mount; remove the old Ctrl+K push |
| `frontend/src/app/beautiful-ui.css`, `globals.css` | Sky remap of `.bui`; remove the Phase 0 `:where(.bui)` block |
| `frontend/src/app/(app)/home/*` | `reload()` after the dialog; 409 copy |
| `frontend/e2e/fixtures.ts`, `e2e/ask.spec.ts` (new), `e2e/foundations.spec.ts`, `e2e/shell.spec.ts`, `e2e/home.spec.ts` | Stubs and tests |

---

### Task 1: Chat threads (backend)

**Interfaces (produced):** the endpoints in Decisions above. Also:
- `routes/chat.py::_thread_for(user_id, thread_id: str | None, question: str) -> ChatThread` either creates a thread or loads one, raising a 404 response when it isn't the caller's.
- `_save_exchange(user_id, thread_id, question, answer)` also bumps `thread.updated_at`.
- `_fold_legacy(user_id) -> None` creates "Earlier chats" once.

- [ ] **Step 1: Write the failing tests** in `test_chat_threads.py`. Use a Flask `app.test_client()` with `utils.auth.verify_token` monkeypatched, as in `tests/test_chat_attach.py`, and stub `routes.chat._ask` to return a canned `result`. The tests:
  - `test_post_without_thread_creates_one_titled_from_question`: a 70-character question gives a title of ≤60 characters ending at a word boundary, and the `thread_id` is returned.
  - `test_post_with_thread_appends`.
  - `test_list_threads_newest_first_with_counts`.
  - `test_get_thread_messages_oldest_first`.
  - `test_delete_thread_removes_messages`.
  - `test_threads_are_per_user`: get, delete and post on another user's thread all give 404, and the row counts are unchanged.
  - `test_legacy_messages_fold_once`: seed 4 messages with no `thread_id`, list twice, and get one "Earlier chats" thread with 4 messages.
  - `test_history_endpoints_are_gone`: `/chat/history` gives 404 or 405.
- [ ] **Step 2: Run** `pytest tests/test_chat_threads.py -q` with the CI env vars. The expected result is FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above. Delete the old history routes and update any tests that used them (`grep -rn "chat/history" backend/tests`).
- [ ] **Step 4: Run** `pytest -q`. The whole suite should pass.
- [ ] **Step 5: Commit** with `feat: chat threads (create, list, resume, delete; legacy history folds into "Earlier chats")`.

### Task 2: Agent memory + "Next:" hardening

**Interfaces:**
- **`run_agent(question, ctx, *, complete=None, max_tool_calls=…, attachment=None, history: list[dict] | None = None)`.** The messages are `[system, *history_msgs, user]`. `history_msgs` holds the last `HISTORY_TURNS = 6` items of `history`, each `{"role": r, "content": c[:HISTORY_CHARS]}` with `HISTORY_CHARS = 1500`, and only roles "user" and "assistant".
- **`POST /chat`** loads the thread's messages before saving the new exchange and passes them as `history` through `_ask(question, user_id, attachment, history)`.

- [ ] **Step 1: Write the failing tests:**
  - **`test_agent_memory.py`** (with a fake `complete` that records the `messages` of its first call and returns a final answer):
    - `test_no_history_prompt_is_unchanged`: only system and user.
    - `test_history_goes_between_system_and_question`.
    - `test_history_is_trimmed`: a 50-message history keeps 6, and a 5,000-character message is cut to 1,500.
    - `test_agent_history_is_this_thread_only`: post two messages in thread A and one in thread B (through the Flask route with `_ask`'s agent call captured), and the history for B's question holds only B's earlier turn.
  - **`test_agent_tools.py`:** `test_split_follow_up_variants`, parametrised over the Decisions list. Each case's answer has no "Next" left in it, and the chip is the request or `None`.
- [ ] **Step 2: Run them.** The expected result is FAIL, for the memory tests and whichever variants break the regex.
- [ ] **Step 3: Implement** according to the Interfaces above, plus the regex fix.
- [ ] **Step 4: Run** `pytest -q`. The whole suite should pass, including the existing eval tests, which must be unchanged.
- [ ] **Step 5: Commit** with `feat: Ask Lumen remembers the thread's last turns; robust "Next:" splitting`.

### Task 3: Backend backlog: proposal claim race + `subject` on found items

- [ ] **Step 1: Write the failing tests:**
  - **`test_api_budget.py::test_decide_claims_atomically`:** approve a proposal after another session has already flipped it to approved under the hood. Simulate this by updating the row directly between the read and the write via monkeypatch, or by asserting that the `rowcount` path returns 409. The result must be 409, with one audit "proposal_approved".
  - **`test_home_signals.py`:** each found kind has `subject`. Duplicate → vendor, spike → category display name, price_rise → vendor, review → `None`.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement.** Write a conditional UPDATE claim at the start of `_decide`, with the same shape as `_save_invoice`, then apply. Add `subject` in `ai/home_signals.py`.
- [ ] **Step 4: Run** `pytest -q`. All should pass.
- [ ] **Step 5: Commit** with `fix: proposals are claimed atomically; found items carry their subject`.

### Task 4: Ask page: threads, fresh chat, suggestions, handoff, "Next:" guard

**Interfaces:**
- **`client.ts`:**
  - `chatApi.threads(): Promise<ChatThread[]>`
  - `chatApi.thread(id): Promise<{ thread: ChatThread; messages: HistoryMessage[] }>`
  - `chatApi.deleteThread(id)`
  - `chatApi.sendMessage(query, file?, threadId?)`, which returns `ChatAnswer` and `thread_id`
  - `type ChatThread = { id; title; updated_at; message_count }`
- **`ThreadRail({ threads, activeId, onSelect, onNew, onDelete })`:**
  - On `lg`+ it is a 248px column inside the Ask page, to the left of the conversation.
  - Below `lg`, a "History" button opens it in a `Sheet`.
  - Its items show the title (truncated) and `relativeTime(updated_at)`.
  - The active item has `aria-current="page"`.
  - Delete is a small icon button with `aria-label="Delete chat"` and an inline confirm.
- **`ChatbotContent` state:** `threadId: string | null`, which is null for a fresh chat, and `messages`.
  - `New chat` clears both.
  - Selecting a thread loads its messages, rendered as history: text only, with no evidence, as today.
  - A send with `threadId` null takes the returned `thread_id` and refreshes the list.
- **Fresh-chat suggestions:** the empty state shows the greeting, then up to 4 suggestion pills from `suggestedQuestions(summary.found, serverSuggestions)`. That function lives in `lib/home-math.ts`, is pure and is unit-tested.
- **`?q=`:**
  - On mount, read `useSearchParams().get("q")`. If it's non-blank: start fresh, send it, and call `router.replace("/ask")` straight away.
  - Use a `useRef` flag so React StrictMode's double mount doesn't send twice.
- **"Next:" guard:** `answer.tsx` drops a final line matching `/^\s*[*_]*next\s*[:：-]?[*_]*\s*$/i` before rendering.

- [ ] **Step 1: Write the failing tests:**
  - **`home-math.spec.ts`:** `suggestedQuestions maps found items, dedupes, caps at 4`.
  - **`ask.spec.ts`:**
    - `fresh chat shows suggestions` (summary with a spike gives a pill "Why is Food up this month?").
    - `sending creates a thread in the rail`.
    - `selecting a thread loads its messages`.
    - `new chat clears the conversation`.
    - `deleting a thread removes it`.
    - `handoff sends once`: visit `/ask?q=How%20much%20on%20food`. One POST `/chat` with that query, the URL becomes `/ask`, then reload and there's no second POST.
    - `blank q sends nothing`.
    - `a bare Next: line is never shown`: a stub answer ends with "\nNext:".
    - `thread rail does not move the conversation`: on desktop, opening and selecting threads doesn't change the composer's x or width.
  - **Fixture:** stubs for `/chat/threads`, `/chat/threads/<id>` and `POST /chat` (which records requests and returns `{success, data: {response, follow_up, sources: [], steps: [], proposals: [], thread_id}}`). Remove the `/chat/history` stub.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above. Remove the "Clear history" control, because per-thread delete replaces it.
- [ ] **Step 4: Run** `npm run test:e2e`. All should pass.
- [ ] **Step 5: Commit** with `feat: Ask Lumen threads (fresh chat, history rail, resume, delete), ?q= handoff, suggestions`.

### Task 5: "Ask anything" palette (⌘/Ctrl+K) in the sidebar

**Interfaces:**
- **`AskPalette({ open, onOpenChange })`** is a `Dialog` with:
  - an input labelled "Ask Lumen anything", with the placeholder "Ask anything about your money…"
  - Enter (non-blank) → `onOpenChange(false)` and `router.push("/ask?q=" + encodeURIComponent(q))`
  - Escape closes it
- **Sidebar:**
  - An "Ask anything" `SidebarMenuButton` sits at the bottom of `SidebarContent` with a fixed-width `<kbd>` showing ⌘K or Ctrl K. That hint is removed from the Ask nav item.
  - Clicking it opens the palette.
  - The keydown handler uses `e.code === "KeyK" && (e.metaKey || e.ctrlKey) && !isTypingTarget(e.target)` to open the palette, not to navigate.
  - In icon-rail mode the button shows only a `Sparkles` icon, with the tooltip "Ask anything (⌘K)".

- [ ] **Step 1: Write the failing tests** in `shell.spec.ts`. Replace Phase 1's `ctrl+k opens Ask` with:
  - `ctrl+k opens the ask palette and enter hands off`: Ctrl+K opens the dialog, typing "Where did my money go" and pressing Enter lands on `/ask` and POSTs that query once.
  - `palette works with caps lock`: `Control+Shift+K` also opens it.
  - `opening the palette does not move the page`.
  - `ask anything button opens the palette`.

  Keep `shortcuts ignore text fields`, and update it so it checks that the palette does not open.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above.
- [ ] **Step 4: Run** `npm run test:e2e`. All should pass.
- [ ] **Step 5: Commit** with `feat: Ask anything palette (⌘/Ctrl+K) hands questions to Ask Lumen`.

### Task 6: Sky restyle of Ask, plus Home backlog (reload, 409 copy)

- [ ] **Step 1: Write the failing tests:**
  - **`foundations.spec.ts`:** replace "dark .bui panels keep readable muted text inside sky" with `Ask uses the Sky palette`. On the harness, the `.bui` probe background computes to `#f4f3ef`, and `--ink-2` text is ≥4.5:1 on it.
  - **`home.spec.ts`:**
    - `closing the draft dialog refreshes activity`: the summary is requested again after closing.
    - `a replaced draft says so`: the approve stub returns 409 for `p1`, and the dialog shows "This draft was replaced. Draft again." with no further approve requests.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement:**
  - Add the remap block to `beautiful-ui.css`, covering every `.bui` variable with a Sky value. The status colours go to `--good`/`--bad`, and the tints go to `color-mix` with 12% alpha.
  - Delete the `:where(.bui)` block in `globals.css`.
  - Change `useHomeData`: `reloadBudget` → `reload()`, which refetches the summary and the budget. The summary goes through `cached`, which a non-GET has already cleared.
  - In the dialog, on an axios 409, set an inline message and stop.
- [ ] **Step 4: Check by eye.** Take a full-page Playwright screenshot of `/ask` with one answered exchange and a proposal, and of `/home`, into the scratchpad, and look at them. Text must be readable and nothing should still be dark. Fix anything off, then add the Ask screenshot to the PR description.
- [ ] **Step 5: Run** `npm run test:e2e`, `tsc`, `lint` and `build`. All should pass, and `/ask` and `/home` should be static. Commit with `feat: Ask Lumen in the Sky palette; Home refreshes after budget decisions`.

### Task 7: Docs, review, ship

- [ ] **Step 1:** Update the docs:
  - `docs/CODEBASE-GUIDE.md` §7c (Ask screen): threads, memory, palette, the Sky remap, and the removed history endpoints.
  - Spec §12: tick the Phase 4 items and the Ctrl+K `e.code` item.
  - STORY: a new entry.
- [ ] **Step 2:** Run the whole-branch review on the most capable model with this Review Focus. Fix Critical and Important findings with RED→GREEN tests. Ledger the minors into §12.
- [ ] **Step 3:** Run everything green: backend `pytest -q`, frontend `npm run test:e2e`, `tsc`, `lint` and `build`. Push `ui-revamp/phase4-ask` and open the PR.
