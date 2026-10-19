# UI revamp inventory (signed-in app)

Date: 2026-10-16. Scope: everything under `frontend/src/app/(app)/*` and the components it uses.
The landing (`app/page.tsx`) and auth pages are already done and are not covered here.

The aim: list what exists, what is broken or fake, and what to keep. Then propose a simple
personal-finance layout that matches what the landing page promises, and an order of small PRs.
Rule of thumb for the revamp: **delete first, reuse second, build last.**

Taste rules that apply to every page (from the owner):

- Fonts: Funnel Sans for text, Newsreader for display headings. Both are already loaded (`app/layout.tsx`).
- Motion only when it explains something (a new row arriving, a panel opening). No stagger-on-load for decoration.
- No layout shift: loading, empty, error and loaded states must take the same space.
- Follow the Vercel web interface guidelines (https://vercel.com/design/guidelines), useorigin.com, designeer.
- Personal finance words: "spending", "bills", "receipts", "subscriptions". Not "invoices", "vendors", "approval queue", "payment approval", "finance teams".

---

## 0. Top findings (read this if nothing else)

1. **Several cards show fake or always-empty data.** The all-time summary endpoint
   (`backend/routes/analytics.py:72-83`) only returns `total_spending`, `monthly_spending`,
   `category_breakdown` and `vendor_breakdown`. Three AI-insights cards read fields it never sends:
   - `spendingTrendGraph.tsx:69` reads `monthly_trends`: the chart is always empty, and under it
     sit three **hard-coded "AI Insights"** with made-up numbers ("November spending of 8316 is 454% above...",
     "your 2024 Q3 averaged 1973") at `spendingTrendGraph.tsx:197-248`.
   - `paymentCalendarCard.tsx:43` reads `payment_calendar`: always shows "Could not load payment calendar."
   - `reminderDetailsCard.tsx:35` reads `upcoming_payments`: always shows "Could not load reminders."
     The real endpoint `/api/analytics/reminders` exists (`backend/routes/ai_analytics.py:91`) and is never called.
2. **Dashboard numbers are wrong.** `section-cards.tsx:51` hard-codes every transaction's status to `"completed"`, so
   "Approved Invoices" is always 100% and "Needs Review" (`section-cards.tsx:189`) is always 0. It counts transactions,
   not the real review queue (`/api/review`). "Total Invoices" asks for 1000 rows (`section-cards.tsx:40`) but the
   server caps a page at 100 (`backend/routes/database_query.py:33`), so the total stops at 100. The real count is in
   `pagination.total_items` and is ignored.
3. **Export is broken.** `ExportDialog` calls `/api/v1/invoices/export` (`lib/api/client.ts:227`). That route does not
   exist in the backend. The whole `invoiceApi` block (`client.ts:162-252`) points at `/api/v1/invoices/*`, which is gone;
   only `exportInvoices` is still used.
4. **The category pie never loads for real users.** `categoryPieChart.tsx:72-75` needs `tokenManager.getUser()`, which
   reads an old localStorage key; with Supabase sign-in this is often empty, so it shows "User not found". Even when it
   works it downloads up to 100 rows and adds them up in the browser (`:78-108`) while the backend already returns
   `category_breakdown`.
5. **Upload says "success" when the receipt went to review.** The OCR route returns a `review` object and a
   "Sent to review: ..." message (`backend/routes/ocr.py:147-154`), but `uploadDialog.tsx:98-107` only checks
   `duplicate` and shows a green tick. The user never learns it is waiting in `/review`.

Other big themes: B2B wording everywhere, two navigation entries for the same page, three different visual styles
(dark neutral dialogs, light gray dialog, `bui` chat), lots of unused code and libraries, and loading states that change size.

---

## 1. Inventory: routes

All pages are client components wrapped in `app/(app)/layout.tsx` (auth guard, profile, sidebar, sticky top bar)
and `app/(app)/template.tsx` (160 ms fade on each navigation, respects reduced motion: `globals.css:887-893`).
Every page except chat uses `DashboardShell` for its header card.

### 1.1 `/dashboard` - "Overview"  (`app/(app)/dashboard/dashboardContent.tsx`)

What it shows: greeting, 4 stat cards (`SectionCards`), a "recent" list (`AnimatedListItemUse`), and a static
"What to watch" card. Actions: Export and Upload dialogs. `?upload=1` opens Upload.

API calls: through children only. `transactionApi.getTransactions` twice with the same URL (deduped by the client cache,
`client.ts:21-30`), `emailConfigApi.getStatus` every 30 s (`emailStatusCard.tsx:38`).

State: none of its own; children refresh each other through `eventBus` `INVOICE_UPDATED` (`lib/events.ts:43-44`).

Problems:
- B2B copy: title "Financial Overview" and "Track invoice intake, review queue health..." (`:30-31`); "Invoice overview",
  "move quickly from extraction to approval" (`:49-53`); "What to watch ... finance teams need" (`:71-75`);
  "Approval queue ... before payment approval" (`:81-87`). Greeting falls back to "Operations" (`:26`).
- "What to watch" (`:68-108`) is static text that never changes. Delete.
- None of it answers the personal question "how am I doing this month?".

### 1.2 `/analytics` - "Spending Analytics"  (`app/(app)/analytics/analyticsContent.tsx`)

What it shows: weekly / monthly / yearly toggle, period picker, 4 cards (`AnalyticsCards`), and an area chart
comparing this period with the last (`SpendingTrendChart`).

API calls: `analyticsApi.getTimeRangeAnalytics` (`/analytics/summary?time_range=...`), called by both children with the
same URL (deduped by cache).

State: `timeRange` and `selectedPeriod` in local state, also read from `?tab=` (`:28-31`, `:112-116`). Period is not
written back to the URL, so refresh or share loses it.

Problems:
- The three period pickers are copy-pasted (`:197-293`). Week maths is hand-rolled and wrong at year edges
  (`:64-78`, always 52 weeks, not ISO weeks).
- Copy: "vendor concentration, and cost drift" (`:309`), eyebrow "Spend Analysis".
- `AnalyticsCards` swaps to a pulse skeleton on every period change (`analyticsCards.tsx:173-193`) - the whole row
  blinks. Errors are only logged (`:149-156`); the user sees stale numbers.
- "Maximum / Minimum Spending" cards (`analyticsCards.tsx:203-216`) are the largest / smallest single transaction.
  Not useful to a person; "Spending Trend" shows "-0" when nothing changed (`:217-227`, `:257`).
- The sidebar lists this page twice: "Analytics" and a "Spending Views > Weekly/Monthly/Yearly" group
  (`app-sidebar.tsx:29-59`).

### 1.3 `/ai-analytics` - "AI Analytics"  (`app/(app)/ai-analytics/aiAnalyticsContent.tsx`)

What it shows: 7 cards: Quick Stats, Payment Calendar, Reminders, Anomaly Detection, AI Suggestions, Spending Trends, Category Breakdown.

API calls: on every visit `aiAnalyticsApi.runAnalysis` (POST `/api/analytics/analyze`) (`:20-40`), plus
`getDashboard`, `getAnomalies`, `getInsights`, `getAllTimeSummary` (3 cards), and `transactionApi.getTransactions`.

State: each card fetches on its own; the badge says "Analyzing live data..." then "Model refreshed" (`:52`) but the
cards never reload after the analysis finishes, so the badge means nothing.

Problems (per card, file `components/ai-analytics/*`):
- `spendingTrendGraph.tsx`: always empty chart (see finding 1), fake "AI Insights" (`:197-248`), legend promises
  "Forecast" and "Budget" lines that have no data (`:118-136`), hex colours hard-coded (`:154-192`), currency default
  "INR" (`:60`).
- `paymentCalendarCard.tsx`: always errors (finding 1). Re-fetches the same all-time data on every month change (`:58`).
  Day cells look clickable (`cursor-pointer`, `:177`) but do nothing.
- `reminderDetailsCard.tsx`: always errors (finding 1). Injects a global scrollbar style with `<style jsx global>` (`:153-168`).
  Row animation delay is `reminder.id * 0.1` s (`:94`) - with real ids that is seconds or minutes.
- `anomalyDetectionCard.tsx`: real data from `/api/analytics/anomalies`. Same `id * 0.1` delay bug (`:126`). Rows look
  clickable but are not (`:128`). Fixed 200 px scroll box (`:118`). Worth keeping as a "Did anyone charge me twice?" item.
- `aiSuggestionsCard.tsx`: real data from `/api/analytics/insights`. Clickable-looking rows with no action (`:162`).
  Never calls `markInsightRead`.
- `quickStatsCard.tsx`: shows "HEALTHY" and "Risk: LOW" when the API sends nothing (`:109`, `:121`) - a made-up verdict.
  "Patterns Detected", "High Risk Anomalies" are model words, not user words.
- `categoryPieChart.tsx`: see finding 4. Legend colour uses `COLORS[index]` with no modulo (`:210`), so the 7th+ category has no colour.
- Every card adds its own framer-motion fade with growing delays (0.1 s ... 0.7 s). Decorative stagger; the page settles
  in about a second and loading boxes (fixed 280-400 px) are a different height from loaded cards: layout shift.

Verdict: delete the page. Move the 2 real cards (anomalies, insights) into Home "Needs your attention"; move categories
into Spending; rebuild reminders/calendar as Bills on the real `/api/analytics/reminders`.

### 1.4 `/chatbot` - "Ask Lumen"  (`app/(app)/chatbot/chatbotContent.tsx`, `components/ask/*`)

What it shows: hero greeting with suggestion chips when empty; otherwise a thread of questions, answers with sources,
work trace, proposal cards, retry; prompt bar with file attach.

API calls: `chatApi.getHistory`, `chatApi.getSuggestions`, `agentApi.proposals` on mount (`:56-72`, `allSettled`, good);
`chatApi.sendMessage` per question; `agentApi.decide` inside `ProposalCard` / `InvoiceCard`.

State: local `messages`, `proposals`, `suggestions`, `loaded`. Pending / error / retry handled per message. Good.

Problems (small; this is the newest and best page):
- Height is hard-coded to the top bar: `h-[calc(100dvh-3.5rem)]` (`:126`). Breaks if the top bar changes.
- "New chat" clears server history with no confirm and no undo (`:103-110`).
- Copy "Ask about spending, invoices or contracts" (`:149`).
- `components/ask/button.tsx` is a second Button (pill, `bui` tokens) next to `components/ui/button.tsx`. The `bui`
  look is the one to keep; the revamp should make one Button with these variants.

Verdict: **keep**. It is the reference for the new look. Only move it to `/ask` and share the shell.

### 1.5 `/documents` - "Documents"  (`app/(app)/documents/documentsContent.tsx`)

What it shows: an "ask your documents" box with cited answers, then a list of uploaded PDFs with type, open, delete.

API calls: `documentsApi.list / upload / remove / ask`, `filesApi.open`.

State: `loading`, `uploading`, `asking`, `answer`. Errors go to toasts.

Problems:
- B2B types and example: "Purchase order", "Policy" (`:17-23`), placeholder "payment terms on PO-U1-202605-06" (`:103`).
  For a person: receipts, bills, rental agreement, insurance, warranty.
- The ask box duplicates Ask Lumen (the agent already searches documents). Delete it here; link to Ask.
- Delete has no confirm (`:69-76`, `:182`). "Loading…" plain text (`:161`) is shorter than the list: layout shift.
- Native `<select>` styled by hand (`:135-146`) while `ui/select.tsx` exists.

### 1.6 `/import` - "Import statement"  (`app/(app)/import/importContent.tsx`)

What it shows: CSV picker, column mapping selects, sample table, counts, import result.

API calls: `statementApi.preview`, `statementApi.import`.

State: `busy` ("preview" | "import"), `error` with raw rows, `result`. Errors are shown inline with `role="alert"`. Good.

Problems:
- Currency default is read once from `profile` in `useState` (`:37`); if the profile loads after the page, it stays "USD".
- Sample table has no horizontal scroll (`:153-172`); breaks on phones.
- "Credits are skipped for now" (`:88`): the app cannot see income or balances yet, which matters for budgets and savings.
- Raw file `<input>` (`:95-101`); no drag and drop. Fine for now, but it should live in the shared "Add" flow.

### 1.7 `/review` - "Review queue (test)"  (`app/(app)/review/reviewContent.tsx`)

What it shows: items the checks were unsure about, with flags, optional corrected total, open original, approve / reject.

API calls: `reviewApi.list`, `reviewApi.decide`, `filesApi.open`.

Problems:
- Marked "(test)" in title and sidebar (`:45`, `app-sidebar.tsx:82`).
- No loading state: shows "Nothing to review" before the list arrives (`:17-30`, `:47-48`).
- Shows raw `confidence 0.62` and invoice-number wording (`:52-53`).
- This is the real "needs review" list, but the dashboard counts something else (finding 2).

Verdict: fold into Transactions as a "To review" tab; Home links to it with the real count.

### 1.8 `/upload`  (`app/(app)/upload/page.tsx`)

Redirects to `/dashboard?upload=1`. Keep as a redirect to the new Add flow.

---

## 2. Inventory: shared components

| File | Used by | What it does | Problems | Verdict |
|---|---|---|---|---|
| `app/(app)/layout.tsx` | all | auth guard, profile, sidebar, top bar | top bar only shows the word "Lumen" (`:24`): no page title, no actions | keep, slim |
| `app/(app)/template.tsx` | all | page fade | fine | keep |
| `components/dashboard-shell.tsx` | all pages | header card with eyebrow, title, description, actions, toolbar | default eyebrow "Finance Workspace" (`:27`); a big bordered card around every title (`:37`) pushes content down | replace with a plain `PageHeader` |
| `components/app-sidebar.tsx` | layout | nav | "Financial command center" (`:124`); "Analytics" listed twice (`:29-59`); "Review (test)" (`:82`); same `FileText` icon twice (`:74`, `:84`); avatar fallback sends the user's name to `ui-avatars.com` (`:101`) - a third-party request with personal data | rebuild nav list; initials fallback, no third party |
| `components/nav-projects.tsx` | sidebar | flat link list | odd name; special case for `/analytics` (`:33-35`) | keep, rename `nav-links` |
| `components/nav-main.tsx` | sidebar | collapsible group | only used for the duplicate "Spending Views" | delete |
| `components/nav-user.tsx` | sidebar | user menu, sign out | fine | keep |
| `components/team-switcher.tsx` | nobody | - | dead | delete |
| `components/AnimatedList.tsx` | nobody | 260-line list with `motion/react` | dead | delete |
| `components/section-cards.tsx` | dashboard | 4 stat cards | finding 2; localStorage `"invoices"` fallback (`:66-67`) shows stale data from another era; emoji logs | delete |
| `components/animatedListItemUse.tsx` | dashboard | recent transactions list + edit dialog | asks 1000 rows (`:55`), gets 100; localStorage fallback (`:79-86`); "No Invoices Yet" (`:190`); "Upload Invoice" does a full page reload to `/upload` (`:201`); every row has a "Review" button that opens an edit dialog, not the review queue (`:311-316`); spinner loading box is a different size from the list | delete; replace with `TransactionList` |
| `components/invoiceEditDialog.tsx` | recent list | edit a transaction | light gray theme hard-coded inside a dark app (`:115`, `text-gray-700` labels); "Save & Approve" (`:74`) approves nothing, it just saves; side-by-side halves (`w-1/2`) do not fit phones | rebuild as `TransactionSheet` (side sheet using `ui/sheet.tsx`) |
| `components/uploadDialog.tsx` | dashboard | multi-file receipt upload | component is called `DialogDemo` (`:20`); hard-coded dark colours (`:170-185`); close button has no label (`:188-193`); Upload button sits inside the file `<label>` (`:209-232`); ignores `review` (finding 5); `key={i}` (`:247`) | rebuild as part of the `Add` sheet |
| `components/exportDialog.tsx` | dashboard | export CSV/JSON with filters | calls a missing endpoint (finding 3); "Export Invoices" (`:103`) | delete now; re-add as a simple "Download CSV" on Transactions |
| `components/emailStatusCard.tsx` | section-cards | Gmail/IMAP status, pause, poll now, disconnect | polls every 30 s on the dashboard (`:38`); a settings control posing as a stat card | move to Settings |
| `components/emailConfigDialog.tsx` | email card | 622-line Gmail / IMAP setup | IMAP password form; very long; mixed copy | keep logic, move to Settings, trim later with the email-ingest work |
| `components/gmailOAuthButton.tsx` | email dialog | Gmail OAuth popup | fine (documented in `docs/CODEBASE-GUIDE.md`) | keep |
| `components/analytics/analyticsCards.tsx` | analytics | 4 period cards | see 1.2 | rebuild as 2-3 `StatTile`s |
| `components/analytics/spendingTrendChart.tsx` | analytics | this vs last period area chart | recharts; hard-coded colours; reuse the data mapping | reuse logic, restyle |
| `components/ai-analytics/*` (7 files) | ai-analytics | see 1.3 | fake / empty / decorative | delete all; keep anomaly + insight data mapping as reference |
| `components/ask/*` | chat | answer, prompt bar, proposal card, work trace, invoice card | the good ones | keep; `invoice-card.tsx` rename to `receipt-card` in copy only |
| `components/profile/profile-provider.tsx` | layout | profile + avatar URL | fine | keep |
| `components/auth/*` | layout | guard, provider, shell | guard spinner is fine | keep |
| `components/server-wake.tsx` | root layout | wakes the backend | fine | keep |
| `components/ui/*` | many | shadcn parts | `breadcrumb.tsx`, `popover.tsx`, `slider.tsx` are unused | delete unused; keep the rest |

### 2.1 `lib/api/client.ts`

- Dead, pointing at removed routes: `invoiceApi.getMyInvoices, uploadInvoice, getInvoiceStats, getInvoice, updateInvoice,
  deleteInvoice, exportInvoices, pollEmails` (`:162-252`).
- Unused but backed by real endpoints (keep, the new pages need them): `aiAnalyticsApi.getReminders` (`:568`),
  `getForecast` (`:580`), `getPatterns` (`:613`), `getRiskScore` (`:587`), `markInsightRead` (`:606`).
- Unused: `aiAnalyticsApi.healthCheck` (`:620`), `isAuthenticated` (`:626`), `transactionApi.createTransaction` (`:518`),
  `deleteTransaction` (`:538`) - the last two are useful for "add / delete a transaction" on the new page, keep them.
- `tokenManager.getUser` (`:76`) reads an old localStorage key; only the pie chart uses it. Remove with the pie.
- The 30 s response cache (`:21-30`) is good; the new pages should rely on it and on `clearApiCache` for Refresh.

### 2.2 Libraries (`frontend/package.json`)

- `mathjs`, `postprocessing`: not imported anywhere. Remove.
- `framer-motion` and `motion`: the same library twice. `framer-motion` is only used by the 7 ai-analytics cards,
  `motion` only by the dead `AnimatedList.tsx`. After the deletions, neither is needed in the app; CSS transitions cover
  the purposeful motion we want. (Check landing/onboarding before removing `motion`.)
- `@tabler/icons-react`: one icon in `section-cards.tsx:3`. Remove; use `lucide-react`.
- `recharts`: three charts. Keep one chart library; load it only on the Spending page (`next/dynamic`) so Home stays light.
- `three`: landing and onboarding only. Not in the app; leave it.

### 2.3 Cross-cutting problems

- **Layout shift**: almost every card swaps a small "Loading..." box for a taller loaded card (ai-analytics, analytics,
  recent list, documents). Fix with skeletons that reserve the final size, and keep old data visible while refreshing.
- **Three visual styles**: dark neutral dialogs with `text-white` and hex gradients (upload, export), a light gray dialog
  (edit), shadcn cards with `bg-card/80 shadow-lg` (pages), and `bui` tokens (chat). Pick `bui` tokens for everything.
- **Fake affordances**: `cursor-pointer` and hover states on rows that do nothing (anomalies, suggestions, calendar).
- **Accessibility**: icon-only close button without label (`uploadDialog.tsx:188`); charts have no text alternative;
  period picker chevrons have no labels (`analyticsContent.tsx:189-194`, `:295-300`); colour-only meaning in severity
  borders and calendar days. Focus styles are inherited from shadcn and mostly fine.
- **Numbers**: `tabular-nums` is used on some cards only; currency default "USD"/"INR" in different places. Use
  `useMoney` (`lib/format.ts`) everywhere.
- **Debug noise**: emoji `logger.debug` / `console.error` lines in section-cards, recent list, upload dialog.

---

## 3. Proposed information architecture

Built around what the landing promises (`app/page.tsx:81-105`): watch your spending, stay on budget, tame subscriptions,
read every bill, see what's coming, grow savings, and Ask Lumen. One question per page.

Sidebar (6 items + settings). Old URLs redirect to the new ones.

| Page | URL | The question it answers | What is on it | Backend today | New backend work |
|---|---|---|---|---|---|
| **Home** | `/home` (from `/dashboard`) | "How am I doing this month?" | Spent this month vs budget (one big number + bar); "Needs your attention": review count, pending proposals, unusual charges, top 3 insights; next 3 bills; last 5 transactions; one "Add" button | `/analytics/summary?time_range=monthly`, `profile.monthly_budget`, `/api/review`, `/api/agent/proposals`, `/api/analytics/anomalies`, `/api/analytics/insights`, `/api/analytics/reminders`, `/transactions?page_size=5` | none for v1. A single `/api/home` summary would cut 7 calls to 1 - only if it is slow |
| **Transactions** | `/transactions` | "Where did my money go?" | Searchable, filterable list (date, category, merchant, amount) with server paging and real total; row opens a side sheet to edit / delete / open the original; tab **To review** (the review queue); "Download CSV" | `GET/PUT/POST/DELETE /transactions` (filters exist, `database_query.py:32-45`), `/api/review`, `/api/files` | free-text search across merchant + description (today only exact filters); CSV export endpoint, or build the CSV in the browser from the paged list |
| **Spending** | `/spending` (from `/analytics`) | "What changed, and am I on budget?" | Week / month / year switch (in the URL); this vs last period chart; category breakdown for the chosen period with budget bars | `/analytics/summary?time_range=...` | category breakdown **for a period** (all-time only today); **per-category budgets** (only one monthly total in the profile) |
| **Bills & subscriptions** | `/bills` | "What repeats, and what is due soon?" | Recurring charges with amount, how often, last seen, "still using?"; upcoming bills list (next 30 days); duplicate-charge alerts | `/api/analytics/patterns` (recurring detection, `ai/pattern_detection.py:26`), `/api/analytics/reminders`, `/api/analytics/anomalies` | check the patterns output is good enough; a "mark as cancelled / ignore" flag on a recurring item |
| **Plan** | `/plan` | "What's coming, and how do I save more?" | Next month forecast; savings goals progress; idle cash hint | `/api/analytics/forecast`, `profile.goals` | goal **targets and amounts** (goals are only tags today); income and balances (statement import skips credits, `importContent.tsx:88`) - needed before "idle cash" is honest. Ship forecast first, hide the rest until the data exists |
| **Files** | `/files` (from `/documents`) | "Where is that receipt / agreement?" | All uploaded receipts, bills, statements and documents in one list; open original; delete with confirm. No separate ask box: "Ask about this file" opens Ask Lumen | `/api/documents`, `/api/files`; receipts come from transactions with `file_key` | one list endpoint that merges documents and receipt files (or two calls merged in the browser for v1) |
| **Ask Lumen** | `/ask` (from `/chatbot`) | "Anything else" | as today | `/chat`, `/api/agent/*` | none |
| **Settings** | `/settings` | "How is my account set up?" | Profile, currency, monthly budget, Gmail / email connection (moved from the dashboard), sign out | `/api/profile`, `/api/v1/email-config/*` | none |

**Add** is not a page: one button (top bar on desktop, floating on mobile) opens a sheet with three choices:
*Snap or upload a receipt* (`/extract`), *Import a bank statement* (`/api/statements/*`), *Connect Gmail* (goes to Settings).
`/upload` and `/import` redirect to Home with the sheet open.

What goes away: the "AI Insights" page (its real parts move to Home and Bills), the duplicate "Spending Views" group,
"Review (test)", the static "What to watch" card, the export dialog, and B2B words.

Words to use: transaction, receipt, bill, merchant (not vendor), category, budget, subscription, "to review"
(not "approval queue"), "spent" (not "outflow").

---

## 4. Components: reuse, rebuild, new

### Reuse as is
`components/ask/*` (answer, prompt-bar, proposal-card, work-trace, invoice-card), `profile-provider`, `auth/*`,
`server-wake`, `nav-user`, `gmailOAuthButton`, `lib/api/client.ts` (minus the dead block), `lib/format.ts` (`useMoney`),
`lib/currency.ts`, `lib/toast.ts`, shadcn `ui/` parts: dialog, sheet, select, dropdown-menu, tooltip, input, label,
separator, skeleton, sidebar, avatar, alert, badge, card.

### Rebuild (keep the logic, new look)
- `app-sidebar` + `nav-projects` -> one `AppNav` with the 6 items, active state from the path, initials avatar.
- `dashboard-shell` -> `PageHeader` (Newsreader title, one-line description, actions slot). No card around it.
- `ui/button` + `ask/button` -> one `Button` with `bui` variants (primary, secondary, quiet) and shadcn sizes.
- `invoiceEditDialog` -> `TransactionSheet` (side sheet, works on phones).
- `uploadDialog` + `import` page -> `AddSheet` (receipt upload with honest "sent to review" result, statement import steps).
- `analyticsCards` + `spendingTrendChart` -> `StatTile` + `PeriodChart` on Spending.
- `reviewContent` -> `ReviewList` inside Transactions.
- `documentsContent` list -> `FileList` on Files.
- `emailStatusCard` + `emailConfigDialog` -> `EmailConnection` section on Settings.

### New (small, shared)
- `StatTile` - label, big tabular number, small change line. Fixed height for loading / empty / error.
- `ListRow` - one row pattern for transactions, bills, files, review items.
- `EmptyState` - one sentence + one action. Same height as the content it replaces.
- `AttentionList` - Home's "Needs your attention" (review, proposals, unusual charges, insights).
- `PeriodSwitch` - week / month / year + previous / next, state in the URL (`?range=month&p=2026-10`).

### Delete list
- `components/AnimatedList.tsx`, `components/team-switcher.tsx`, `components/nav-main.tsx`
- `components/section-cards.tsx`, `components/animatedListItemUse.tsx`, `components/exportDialog.tsx`
- `components/ai-analytics/` (all 7 files) and `app/(app)/ai-analytics/`
- `components/ui/breadcrumb.tsx`, `components/ui/popover.tsx`, `components/ui/slider.tsx`
- After their replacements land: `uploadDialog.tsx`, `invoiceEditDialog.tsx`, `dashboard-shell.tsx`, `ask/button.tsx`,
  `app/(app)/review/`, `app/(app)/import/` (as pages; keep redirects)
- `lib/api/client.ts`: `invoiceApi` (all), `tokenManager.getUser/setUser` once nothing reads them, `aiAnalyticsApi.healthCheck`, `isAuthenticated`
- `package.json`: `mathjs`, `postprocessing`, `@tabler/icons-react`, `framer-motion` (and `motion` if landing/onboarding do not need it)

---

## 5. Order of work (one PR each)

Each step is small, keeps the app working, and ends with a PR into `refactor`. Update `docs/CODEBASE-GUIDE.md` in each.

1. **Stop showing wrong things** (no redesign). Delete the fake "AI Insights" block and the three always-empty cards;
   make "Needs review" use `/api/review`; use `pagination.total_items`; remove the export button; show "Sent to review"
   in the upload result. Smallest PR with the biggest honesty win.
2. **Delete dead code and libraries.** Everything in the delete list that has no replacement needed
   (`AnimatedList`, `team-switcher`, unused `ui/*`, `invoiceApi`, `mathjs`, `postprocessing`, `@tabler`). Build must pass.
3. **App frame.** `AppNav` with the new IA (pages that do not exist yet point at the old ones), `PageHeader`, one `Button`,
   `bui` tokens on the app body, redirects map. No third-party avatar.
4. **Shared parts.** `StatTile`, `ListRow`, `EmptyState`, `PeriodSwitch` with fixed-size loading states. Use them first on Ask/Files to prove them.
5. **Transactions page** with `TransactionSheet` and the **To review** tab. Delete `animatedListItemUse`, `invoiceEditDialog`, `/review`.
6. **Home page.** Month vs budget, attention list, next bills, last 5 transactions, Add button. Delete `section-cards`,
   `dashboardContent`; `/dashboard` redirects to `/home`.
7. **Add sheet.** Receipt upload + statement import in one place. Delete `uploadDialog`, `/import` page.
8. **Settings page.** Profile, budget, email connection moved off the dashboard.
9. **Spending page.** Period switch in the URL, this vs last chart (lazy-loaded), categories. Delete `/analytics` and
   `/ai-analytics`. Backend: period category breakdown (small, can ship in the same PR).
10. **Bills & subscriptions page** on `/api/analytics/patterns` + `/reminders`. Check the backend output first; fix it there if weak.
11. **Files page** (documents + receipt originals). Delete the ask box.
12. **Plan page**: forecast only. Goals and idle cash wait for their backend work (goal targets, income/balances).
13. **Polish pass** against the Vercel guidelines: keyboard, focus, labels, reduced motion, `tabular-nums`,
    no layout shift check (throttle network, compare loading vs loaded), mobile at 375 px.

Backend work, in the order the pages need it: period category breakdown (step 9), recurring "ignore/cancelled" flag
(step 10), file list merge (step 11, optional), per-category budgets, goal targets, income and balances (later).
