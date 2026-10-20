# UI Revamp Phase 1 (App Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the November-2025 shell with the new information architecture. That means a new sidebar with an icon-rail collapse, a top-right avatar menu, and new URLs with redirects from the old ones. Old page bodies stay as they are until Phase 5.

**Architecture:**
- **Routes.** Page folders are renamed or added under `app/(app)/`. Old URLs move to new ones through `next.config.js` `redirects()`, which run before middleware and carry query strings over.
- **Sidebar.** It keeps the shadcn `Sidebar` primitives, with new items. The collapsed state is read from the existing `sidebar_state` cookie on the server, so the first paint is already correct and nothing jumps.
- **Avatar menu.** It lives in the existing sticky header.
- **Tests.** A Playwright fixture fakes a signed-in session: a Supabase session in localStorage, plus stubbed backend responses. This lets e2e drive the real shell.

**Tech Stack:** Next.js 14 app router, shadcn sidebar/dropdown, `lucide-react`, Playwright (from Phase 0).

**Spec:** `docs/superpowers/specs/2026-10-20-ui-revamp-design.md`, sections 3 and 6.3 and phase 1 of section 10. Builds on the Phase 0 branch `ui-revamp/phase0-foundations` (PR #89).

## Global Constraints

- **IA, verbatim from spec section 3:**
  - Home.
  - TRACK: Spending, Bills & subscriptions.
  - PLAN: Budget, Forecast. **Both are hidden until their pages exist, so Phase 1 renders no PLAN group.**
  - A separator, then the stand-alone items: Receipts & statements (with the review badge) and Ask Lumen (⌘K).
- **Group labels name what the user does.** Never "Workspace", "AI", "Data" or "Compare".
- **Profile, settings, API keys (BYOK) and log out all live in the top-right avatar menu.** The sidebar is navigation only, and there is no theme item yet.
- **Collapse:**
  - An icon rail of about 56px (`3.5rem`) with tooltips.
  - Toggled with a button or Ctrl/⌘+B, and remembered across visits.
  - Content must not jump on load.
- **The zero layout-shift rule (spec 6.3) applies.** The Phase 0 shift test pattern is reused for the avatar menu.
- **Suggested new routes, adopted:** `/home`, `/spending`, `/bills`, `/receipts`, `/ask`, plus the existing `/settings`.
- **Old URLs must keep working** for bookmarks and the demo.
- **Git:** no "claude" in branch names and no attribution lines. Open one PR into `refactor`. Keep `docs/CODEBASE-GUIDE.md` current.

## Decisions this plan makes (owner may override)

- **Old → new redirects:**
  - `/dashboard` → `/home`
  - `/analytics` → `/spending`
  - `/ai-analytics` → `/spending`
  - `/chatbot` → `/ask`
  - `/documents` → `/receipts`
  - `/import` → `/receipts?tab=import`
  - `/review` → `/receipts?tab=review`
  - `/upload` → `/home?upload=1`

  All are `permanent: false`, because routes may still change before launch.
- **Interim page bodies until Phase 5:**
  - `/spending`: `AnalyticsContent`, then `AiAnalyticsContent`, stacked.
  - `/bills`: `PaymentCalendarCard` and `ReminderDetailsCard`. These two cards also still appear inside `/spending`. That duplication is accepted until Phase 5.
  - `/receipts`: a tab bar (Documents | Import | Review, driven by `?tab=`) over the existing contents.
- **Collapsed state is server-read with `cookies()` in `(app)/layout.tsx`.** This makes the app routes render dynamically, which costs one serverless invocation per navigation on Vercel. The alternative, reading it on the client, causes a visible width jump on every hard load, which breaks the owner's no-shift rule. The cost should be revisited in Phase 6 (perf).
- **⌘K / Ctrl+K navigates to `/ask` for now.** The sidebar Ask input with handoff is Phase 4.

## Review Focus

1. **Hard reload with the sidebar collapsed:** the first paint must already be a rail, with no expand-then-collapse. Task 3 test `collapsed state survives reload without a jump`.
2. **Old bookmarked URLs with query strings:** `/analytics?tab=weekly` must land on `/spending?tab=weekly`. Task 2 test `old URLs redirect`.
3. **Unauthenticated access to new URLs:** these must be protected exactly like the old ones, through the middleware list and matcher. Task 2 test `new URLs require a session`.
4. **Opening the avatar menu must not move the page,** which was the original bug's trigger. Task 4 test `avatar menu does not move the page`.
5. **Keyboard users:** Ctrl+B and Ctrl+K must not fire while typing in an input or textarea. Ask Lumen's composer is a textarea, and Ctrl+K inside it must not navigate away. Task 3 test `shortcuts ignore text fields`.

## File map

| File | Change |
|---|---|
| `frontend/e2e/fixtures.ts` (new) | `signIn(page)`: fake Supabase session plus `lumen_session` cookie, and stubs for every backend call to `NEXT_PUBLIC_BACKEND_URL` |
| `frontend/e2e/shell.spec.ts` (new) | Phase 1 tests |
| `frontend/src/app/(app)/home/` | `git mv dashboard home` (title "Home") |
| `frontend/src/app/(app)/ask/` | `git mv chatbot ask` (title "Ask Lumen") |
| `frontend/src/app/(app)/spending/page.tsx`, `bills/page.tsx`, `receipts/page.tsx` (new) | Interim compositions (see Decisions). `analytics/`, `ai-analytics/`, `documents/`, `import/` and `review/` keep only their `*Content.tsx`; their `page.tsx` files and `upload/` are deleted |
| `frontend/next.config.js` | Redirect list |
| `frontend/src/middleware.ts`, `frontend/src/app/robots.ts` | Protect and disallow the new prefixes (`/home`, `/spending`, `/bills`, `/receipts`, `/ask`, `/settings`); drop the old ones, since redirects run first |
| In-app links | `login-content.tsx`, `onboarding-content.tsx` (×2), `reset-password/page.tsx`, `error.tsx`, `import/importContent.tsx`: `/dashboard` → `/home`. `demo/page.tsx` (×2): `/chatbot` → `/ask`. `animatedListItemUse.tsx`: `/upload` → `/home?upload=1`. `dashboardContent.tsx` keeps reading `?upload=1` |
| `frontend/src/components/app-sidebar.tsx` | Rewritten (Task 3) |
| `frontend/src/components/avatar-menu.tsx` (new) | Header avatar dropdown (Task 4) |
| `frontend/src/components/ui/sidebar.tsx:32` | `SIDEBAR_WIDTH_ICON = "3.5rem"` |
| `frontend/src/app/(app)/layout.tsx` | Server component; reads the cookie; header gets `AvatarMenu` |
| Delete | `nav-main.tsx`, `nav-projects.tsx`, `nav-user.tsx`, `team-switcher.tsx` (only `app-sidebar` imports them) |

---

### Task 1: Signed-in e2e fixture

**Files:** Create `frontend/e2e/fixtures.ts`, `frontend/e2e/shell.spec.ts`

**Interfaces:**
- Produces `export async function signIn(page: Page, opts?: { reviewCount?: number }): Promise<void>`. It must run **before** `page.goto` and does three things:
  1. Adds the cookie `lumen_session=1` for `localhost`.
  2. Adds an init script that writes the localStorage key `sb-127-auth-token`. This is supabase-js's default `sb-<first host label>-auth-token` for `http://127.0.0.1:54321`; confirm it by reading what `getSession` looks up. The value is `{access_token:"e2e", refresh_token:"e2e", token_type:"bearer", expires_in:3600, expires_at:<now+3600 s>, user:{id:"e2e-user", email:"e2e@lumen.test", user_metadata:{full_name:"E2E User"}}}`.
  3. Adds `page.route("http://127.0.0.1:9/**", …)`. Use `GET /api/review` → `{items: Array(reviewCount ?? 0).fill(minimal flagged item)}` and `GET /api/profile` → `{display_name:"E2E User"}`. Every other request gets `200 {}`. Return an empty array instead wherever the calling code maps over the result. Find those by watching the console in Step 2.
- Every later e2e test in this plan uses `signIn`.

- [ ] **Step 1: Write the test** `signed-in shell renders` in `shell.spec.ts`. It calls `signIn(page)` and `page.goto("/dashboard")` (the old URL; Task 2 renames it), then expects `getByRole("navigation")` or the sidebar to be visible, and expects no element with the text "Redirecting to sign in".
- [ ] **Step 2: Run** `npx playwright test e2e/shell.spec.ts`. The expected result is a PASS once the fixture works. A first failure that names a crashing page because a stub has the wrong shape is fixed in `fixtures.ts`, not in app code. Check `page.on("pageerror")`: there must be no uncaught errors.
- [ ] **Step 3: Commit** with `test: signed-in e2e fixture (fake supabase session + backend stubs)`.

### Task 2: New routes, redirects, protection, links

**Files:** See the file map rows for routes, `next.config.js`, middleware, robots and in-app links.

**Interfaces:**
- Produces the routes `/home`, `/spending`, `/bills`, `/receipts` (where `?tab=documents|import|review` defaults to documents) and `/ask`.
- Page titles are, exactly: "Home", "Spending", "Bills & subscriptions", "Receipts & statements" and "Ask Lumen".

- [ ] **Step 1: Write the failing tests** in `shell.spec.ts`:

```ts
const moved: [string, string][] = [
  ["/dashboard", "/home"], ["/analytics?tab=weekly", "/spending?tab=weekly"], ["/ai-analytics", "/spending"],
  ["/chatbot", "/ask"], ["/documents", "/receipts"], ["/import", "/receipts?tab=import"],
  ["/review", "/receipts?tab=review"], ["/upload", "/home?upload=1"],
];
test("old URLs redirect", async ({ request }) => {
  for (const [from, to] of moved) {
    const r = await request.get(from, { maxRedirects: 0 });
    expect([307, 308]).toContain(r.status());
    expect(r.headers()["location"]).toBe(to);
  }
});
test("new URLs require a session", async ({ request }) => {
  for (const p of ["/home", "/spending", "/bills", "/receipts", "/ask", "/settings"]) {
    const r = await request.get(p, { maxRedirects: 0 });
    expect(r.headers()["location"]).toContain("/login?reason=unauthorized");
  }
});
test("new pages render for a signed-in user", async ({ page }) => {
  await signIn(page);
  for (const [p, title] of [["/home","Home"],["/spending","Spending"],["/bills","Bills & subscriptions"],
    ["/receipts","Receipts & statements"],["/receipts?tab=review","Receipts & statements"],["/ask","Ask Lumen"]]) {
    await page.goto(p);
    await expect(page).toHaveTitle(new RegExp(`^${title}`));
  }
});
```

- [ ] **Step 2: Run them.** The expected result is all three FAIL, with a 404 or no redirect.
- [ ] **Step 3: Implement.**
  - Run the `git mv` renames.
  - Add the three new `page.tsx` files, each exporting `metadata.title`.
  - `receipts/page.tsx` is a client tab bar of `<Link href="?tab=…">`, styled `label-mono`, with the active tab underlined. Below it, render the matching existing `*Content`.
  - Add the redirects to the list in `next.config.js`.
  - Update the middleware prefixes and matcher, and update `robots.ts`.
  - Update the in-app links listed in the file map.
  - Then confirm none are left: `grep -rnE '"/(dashboard|chatbot|analytics|ai-analytics|documents|import|review|upload)["?]' src` should return no output, except `nav-projects.tsx`, which Task 5 deletes.
- [ ] **Step 4: Run** `npm run test:e2e`. The expected result is that everything passes, including the Phase 0 suite.
- [ ] **Step 5: Commit** with `feat: new app routes (/home /spending /bills /receipts /ask) with redirects from old URLs`.

### Task 3: Sidebar: new IA, icon rail, remembered state, shortcuts

**Files:** `app-sidebar.tsx` (rewrite), `ui/sidebar.tsx:32`, `(app)/layout.tsx`, `shell.spec.ts`

**Interfaces:**
- Produces the `AppSidebar` items as data, in this order:
  - Home: `/home`, icon `House`.
  - Group label "Track":
    - Spending: `/spending`, icon `ChartLine`.
    - Bills & subscriptions: `/bills`, icon `CalendarClock`.
  - `SidebarSeparator`.
  - Receipts & statements: `/receipts`, icon `Receipt`. Shows a badge with the `reviewApi.list()` length when it is greater than 0, and hides it on error.
  - Ask Lumen: `/ask`, icon `Sparkles`. Shows a `<kbd>⌘K</kbd>` hint, or `Ctrl K` when `navigator.platform` isn't a Mac. Detect this after mount; the hint is the same width either way, so nothing shifts.
- Active item rule: `pathname === url || pathname.startsWith(url + "/")`.
- Every item passes `tooltip={label}`.
- Header: the logo plus "Lumen", with no tagline.
- `(app)/layout.tsx` becomes a server component. It runs `const defaultOpen = cookies().get("sidebar_state")?.value !== "false"` and passes that to `SidebarProvider defaultOpen`. Client-only wrappers (`AuthGuard`, `ProfileProvider`, `MotionConfig`) stay as children.
- The ⌘K handler lives in `app-sidebar.tsx`: a `keydown` listener that calls `router.push("/ask")`.

- [ ] **Step 1: Write the failing tests:**
  - **`sidebar shows the new IA`:** after `signIn` and `/home`, the visible sidebar link texts are exactly `["Home","Spending","Bills & subscriptions","Receipts & statements","Ask Lumen"]`, there is a group label "Track", and the page has no text "Workspace", "Compare" or "Financial command center".
  - **`review badge counts flagged receipts`:** with `signIn(page,{reviewCount:3})`, the Receipts item contains "3".
  - **`ctrl+b collapses to a 56px rail with tooltips`:**
    1. Press `Control+b`.
    2. The width of `[data-slot=sidebar-gap]` (or the sidebar container) is 56px ± 1.
    3. Item labels are not visible.
    4. Hovering the Spending icon shows the tooltip "Spending".
  - **`collapsed state survives reload without a jump`:**
    1. Collapse, then reload.
    2. Before any script runs (`page.goto(url, { waitUntil: "commit" })` plus reading the HTML through `request.get` with the `sidebar_state=false` cookie), the server HTML contains `data-state="collapsed"`.
    3. After load, the rail width is 56px.
  - **`ctrl+k opens Ask`:** on `/home`, pressing `Control+k` lands on `/ask`.
  - **`shortcuts ignore text fields`:** on `/ask`, focus the composer textarea and press `Control+k` and `Control+b`. The URL is still `/ask` and the sidebar state is unchanged. The shadcn handler may need an `isTypingTarget(e.target)` guard: skip when the target is an `input`, a `textarea` or `[contenteditable]`.
- [ ] **Step 2: Run them.** The expected result is FAIL, because the old IA still shows "Workspace".
- [ ] **Step 3: Implement** according to the Interfaces above. Delete the `NavMain` and `NavProjects` imports.
- [ ] **Step 4: Run** `npm run test:e2e`. The expected result is that everything passes.
- [ ] **Step 5: Commit** with `feat: sidebar with new IA, 56px icon rail, remembered collapse, Ctrl+K to Ask`.

### Task 4: Header avatar menu (profile, settings, keys, log out)

**Files:** Create `components/avatar-menu.tsx`; modify `(app)/layout.tsx` (header) and `app-sidebar.tsx` (remove the `SidebarFooter`/`NavUser`).

**Interfaces:**
- `export function AvatarMenu(): JSX.Element` uses `useAuth` and `useProfile`, with the same name and avatar fallback logic `app-sidebar` has today.
- Trigger: a round 32px avatar button with `aria-label="Account menu"`.
- Menu (shadcn `DropdownMenu`, `align="end"`):
  - A label with the name and email.
  - "Settings" → `/settings`.
  - "API keys" → `/settings#keys`. Add `id="keys"` to the BYOK section in `settingsContent.tsx`.
  - A separator.
  - "Log out", which calls `authApi.logout()` and then `router.replace("/login")`, the same as `nav-user` does today.
- The header shows the sidebar trigger on the left and `AvatarMenu` on the right. The "Lumen" text in the header is removed.

- [ ] **Step 1: Write the failing tests:**
  - **`avatar menu has account actions`:** after `signIn` and `/home`, click `getByRole("button",{name:"Account menu"})`. The menu items are "Settings", "API keys" and "Log out", and the sidebar has no email text.
  - **`avatar menu does not move the page`:** the Phase 0 pattern. Take the bounding box of `#main` before and after opening the menu on `/ask` and on `/home`; x and width must be unchanged.
  - **`log out returns to login`:** click "Log out". The URL matches `/login`. Supabase `signOut` will call the stubbed host, so return 204 for `**/auth/v1/logout`.
- [ ] **Step 2: Run them.** The expected result is FAIL, because there is no "Account menu" button.
- [ ] **Step 3: Implement** according to the Interfaces above.
- [ ] **Step 4: Run** `npm run test:e2e`. The expected result is that everything passes.
- [ ] **Step 5: Commit** with `feat: top-right avatar menu with settings, API keys and log out`.

### Task 5: Clean up and ship

- [ ] **Step 1:** Delete `nav-main.tsx`, `nav-projects.tsx`, `nav-user.tsx` and `team-switcher.tsx`. Running `grep -rn "nav-main\|nav-projects\|nav-user\|team-switcher" src` should return no output.
- [ ] **Step 2:** Run each of these:
  - `npx tsc --noEmit`, `npm run lint` and `npm run build`, with the dummy env from Phase 0. All should be clean.
  - `npm run test:e2e`: everything passes.
- [ ] **Step 3:** Update `docs/CODEBASE-GUIDE.md` §7b2 with the new routes and their redirects, the sidebar data and badge, the cookie-driven collapse (and why the layout is dynamic), the avatar menu and the e2e `signIn` fixture.
- [ ] **Step 4:** Commit, push the `ui-revamp/phase1-shell` branch and open a PR into `refactor`. If #89 isn't merged yet, base the PR on `ui-revamp/phase0-foundations` and say so in the body. The PR body lists the tests, the redirect table and the decisions above. Run the whole-branch review first, as in Phase 0.
