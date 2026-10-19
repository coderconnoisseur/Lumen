# UI Revamp Phase 0 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the ground every later revamp phase builds on: no layout shift from overlays, the Sky light theme scoped to the signed-in app, the new type roles, and one motion setup that honours reduced-motion.

**Architecture:** One global CSS fix neutralises Radix's scroll-lock compensation, so every overlay stops nudging content. Sky tokens live in `globals.css` under `:root:has([data-app-theme="sky"])`. That puts them on `<html>` whenever the app shell is mounted, so portaled menus and dialogs pick them up too. The public pages keep the forced dark theme. A dev-only harness page plus Playwright (Chromium and Firefox) proves all of it.

**Tech Stack:** Next.js 14 app router, Tailwind v4 (`@theme inline`), shadcn/Radix, `next/font`, `motion` v12 (`motion/react`), `@playwright/test` (dev only).

**Spec:** `docs/superpowers/specs/2026-10-20-ui-revamp-design.md` (sections 5, 6; phase 0 of section 10). Mockup: `docs/superpowers/specs/2026-10-20-ui-revamp/home-mockup.html`.

## Global Constraints

- Sky is light only and scoped to the signed-in `(app)` route group. Landing, login and onboarding stay dark, and the root layout's forced `dark` class remains.
- Fonts: Funnel Sans (UI and numbers), Newsreader (serif headlines and brief), IBM Plex Mono (labels, 10.5px, 0.12em tracking, uppercase). Load all of them through `next/font` with no FOUT-driven shift.
- Motion: 150–250ms, ease-out, opacity and transform only. Everything off under `prefers-reduced-motion`. Use the single library `motion` and remove `framer-motion`.
- Zero layout-shift rule: an interaction in one region may not change the size or position of another region.
- Playwright is a dev dependency and runs locally only. Do not add it to `.github/workflows/ci.yml`.
- Git: branch from `refactor`. Do not use "claude" in branch names. Open one PR into `refactor` on `coderconnoisseur/Lumen`. Keep `docs/CODEBASE-GUIDE.md` current.

## Review Focus

1. **Portaled overlays outside the app wrapper** (menus, dialogs, selects render into `<body>`): they must use Sky colours, not the dark theme. Task 2 test `portaled menu is sky`.
2. **Firefox on Windows** (the owner's browser, where the bug was seen) has classic scrollbars. The shift test runs in Firefox as well as Chromium. Task 1 config.
3. **Muted text contrast:** the mockup's `#7c7a74` is only 3.9:1 on the page background. The plan uses `#6b6963` (4.9:1 on bg, 4.7:1 on sidebar). Task 2 test `muted text meets AA`.
4. **Public pages must stay dark:** Sky must not leak onto `/login`. Task 2 test `login stays dark`.
5. **Reduced motion:** transitions must collapse to near zero. Task 3 test `reduced motion kills transitions`.

## File map

| File | Responsibility |
|---|---|
| `frontend/playwright.config.ts` (new) | Two projects (chromium, firefox), dev server on port 3100 with dummy public env |
| `frontend/e2e/foundations.spec.ts` (new) | All Phase 0 checks |
| `frontend/src/app/dev/layout-shift/page.tsx` (new) | Dev-only harness: Sky wrapper, centred column, tall content, one of each overlay. Returns `notFound()` in production |
| `frontend/src/app/globals.css` | Scroll-lock neutraliser, Sky token block, label utility, reduced-motion rule, font theme vars |
| `frontend/src/app/layout.tsx` | Add IBM Plex Mono via `next/font` |
| `frontend/src/app/(app)/layout.tsx` | `data-app-theme="sky"` on the shell; `MotionConfig reducedMotion="user"` |
| `frontend/src/lib/motion.ts` (new) | Shared durations and easing |
| `frontend/src/components/ai-analytics/*.tsx` (7 files) | `framer-motion` → `motion/react` |
| `frontend/package.json` | `+@playwright/test` (dev), `-framer-motion`, script `test:e2e` |
| `docs/CODEBASE-GUIDE.md` | Note the theme scope, harness and e2e command |

---

### Task 1: Layout-shift guard (harness, failing test, global fix)

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/foundations.spec.ts`, `frontend/src/app/dev/layout-shift/page.tsx`
- Modify: `frontend/src/app/globals.css` (inside `@layer base`), `frontend/package.json`

**Interfaces:**
- Produces: harness route `/dev/layout-shift` with test ids `probe` (the centred column), and `open-dropdown`, `open-dialog`, `open-select`, `open-popover`, `open-sheet` (triggers). It also has `transition-probe`, an element with `transition: opacity 200ms`, which Task 3 uses. The npm script `test:e2e` runs `playwright test`. Later tasks add tests to `e2e/foundations.spec.ts`.

- [ ] **Step 1: Install and configure Playwright**

  1. Run `npm i -D @playwright/test` and then `npx playwright install chromium firefox`.
  2. Add `"test:e2e": "playwright test"` to `package.json` scripts.
  3. Write `playwright.config.ts` with these settings:
     - `testDir: "e2e"`
     - `use.baseURL: "http://localhost:3100"`
     - `projects: [{name:"chromium",use:devices["Desktop Chrome"]},{name:"firefox",use:devices["Desktop Firefox"]}]`
     - `webServer: { command: "npx next dev -p 3100", url: "http://localhost:3100/dev/layout-shift", reuseExistingServer: false, timeout: 180_000, env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-dummy", NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:9" } }`

  There is no `.env.local` in the repo. The dummy values only have to let `createClient` construct. If the Next dev error overlay still appears because a backend or Supabase call fails, make that call fail quietly at its source. Do not hide the overlay.

- [ ] **Step 2: Write the harness page `src/app/dev/layout-shift/page.tsx`**

  - Make it a client component that renders inside a wrapper `<div data-app-theme="sky">`.
  - At render time, if `process.env.NODE_ENV === "production"`, call `notFound()`.
  - Inside the wrapper, add `<main data-testid="probe" className="mx-auto max-w-2xl">`. Fill it with about 3000px of paragraphs so the page scrolls.
  - Put one trigger of each kind at the top of `main`, using the existing wrappers in `@/components/ui/*`: DropdownMenu, Dialog, Select, Popover and Sheet, each with the test ids listed above.
  - Add `<div data-testid="transition-probe" style={{transition:"opacity 200ms"}} />`.

- [ ] **Step 3: Write the failing test**

```ts
// e2e/foundations.spec.ts
import { test, expect } from "@playwright/test";

const overlays = [
  ["open-dropdown", '[role="menu"]'],
  ["open-dialog", '[role="dialog"]'],
  ["open-select", '[role="listbox"]'],
  ["open-popover", "[data-radix-popper-content-wrapper]"],
  ["open-sheet", '[role="dialog"]'],
] as const;

for (const [trigger, surface] of overlays) {
  test(`opening ${trigger} does not move the page`, async ({ page }) => {
    await page.goto("/dev/layout-shift");
    const probe = page.getByTestId("probe");
    const before = await probe.boundingBox();
    await page.getByTestId(trigger).click();
    await expect(page.locator(surface).first()).toBeVisible();
    const after = await probe.boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.width).toBeCloseTo(before!.width, 0);
  });
}
```

- [ ] **Step 4: Run it and confirm it fails**

  Run `npm run test:e2e -- -g "does not move"`. The expected result is FAIL on at least the modal overlays (dropdown, dialog, select, sheet), where `x` or `width` differs by roughly the scrollbar width.

  If nothing fails, the harness is not reproducing the bug. Check that the page really scrolls and that the overlays are modal before you go on. Do not skip this check.

- [ ] **Step 5: Add the global fix in `globals.css` `@layer base`**

```css
html { scrollbar-gutter: stable; }
/* Radix modals lock scroll via react-remove-scroll, which adds margin/padding equal to the scrollbar width and
   shifts centred content. The gutter already reserves that space, so cancel the compensation. Higher specificity
   than the runtime-injected `body[data-scroll-locked]` rule, which is appended after this sheet. */
html body[data-scroll-locked] { margin-right: 0 !important; padding-right: 0 !important; }
```

- [ ] **Step 6: Run the tests and confirm they pass in both browsers**

  Run `npm run test:e2e -- -g "does not move"`. The expected result is 10 passed (5 overlays × 2 browsers).

  If any test still fails, debug it with superpowers:systematic-debugging before you change the approach. Do not patch individual components with `modal={false}` unless the root cause is component-specific.

- [ ] **Step 7: Confirm by hand in the real app**

  Run `npm run dev` with the real env, start a demo session, open Ask Lumen and open the profile menu. The chat column must not move. Check in Firefox.

- [ ] **Step 8: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e frontend/src/app/dev frontend/src/app/globals.css frontend/package.json frontend/package-lock.json
git commit -m "fix: overlays no longer shift page content; add layout-shift e2e guard"
```

---

### Task 2: Sky visual system (tokens, fonts, label style)

**Files:**
- Modify: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`, `frontend/src/app/(app)/layout.tsx`
- Test: `frontend/e2e/foundations.spec.ts`

**Interfaces:**
- Consumes: the harness from Task 1, whose wrapper already carries `data-app-theme="sky"`.
- Produces:
  - The shadcn variables (`--background`, `--card`, …) resolve to Sky wherever `[data-app-theme="sky"]` is mounted.
  - New tokens: `--good`, `--bad`, `--accent-soft`, `--band`.
  - Tailwind utilities `bg-good`, `text-good`, `bg-bad`, `text-bad`, `bg-accent-soft`, `font-serif` (Newsreader), `font-label` (IBM Plex Mono), plus a `.label-mono` utility class.
  - Later phases use only these names.

- [ ] **Step 1: Write the failing tests**

```ts
// helper in foundations.spec.ts: any CSS colour -> [r,g,b] via canvas (works for oklch)
async function rgb(page, css: string) {
  return page.evaluate((c) => { const x = document.createElement("canvas").getContext("2d")!;
    x.fillStyle = c; x.fillRect(0, 0, 1, 1); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)); }, css);
}
const ratio = (a: number[], b: number[]) => { const L = (c: number[]) => { const f = (v: number) => { v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
  const [h, l] = [L(a), L(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };

test("sky tokens apply to page", async ({ page }) => {
  await page.goto("/dev/layout-shift");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await rgb(page, bg)).toEqual([244, 243, 239]);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
});
test("portaled menu is sky", async ({ page }) => {
  await page.goto("/dev/layout-shift");
  await page.getByTestId("open-dropdown").click();
  const bg = await page.locator('[role="menu"]').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await rgb(page, bg)).toEqual([255, 255, 255]);
});
test("muted text meets AA", async ({ page }) => {
  await page.goto("/dev/layout-shift");
  const v = await page.evaluate(() => { const s = getComputedStyle(document.documentElement);
    return [s.getPropertyValue("--muted-foreground"), s.getPropertyValue("--background"), s.getPropertyValue("--sidebar")]; });
  const [m, bg, side] = await Promise.all(v.map((c) => rgb(page, c)));
  expect(ratio(m, bg)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(m, side)).toBeGreaterThanOrEqual(4.5);
});
test("login stays dark", async ({ page }) => {
  await page.goto("/login");
  const [r] = await rgb(page, await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  expect(r).toBeLessThan(60);
});
test("type roles load", async ({ page }) => {
  await page.goto("/dev/layout-shift");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/Funnel/i);
});
```

- [ ] **Step 2: Run them and confirm they fail**

  Run `npm run test:e2e -- -g "sky|portaled|muted|login|type roles"`. The expected result is FAIL on `sky tokens`, `portaled`, `muted` and `type roles`. `login stays dark` should already pass.

- [ ] **Step 3: Add the Sky block to `globals.css`, after the `.dark {}` block**

  Use the selector `:root:has([data-app-theme="sky"])` and add `color-scheme: light !important;`. The `!important` is needed to beat the inline `style={{colorScheme:"dark"}}` on `<html>`. Set these values (from the spec; `--muted-foreground` is darkened for contrast, see Review Focus 3):

| Variable | Value |
|---|---|
| `--background` | `oklch(0.964 0.005 95)` (#f4f3ef) |
| `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground` | `oklch(0.222 0.002 107)` (#1b1b1a) |
| `--card`, `--popover`, `--primary-foreground`, `--sidebar-primary-foreground` | `oklch(1 0 0)` |
| `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--chart-1` | `oklch(0.564 0.185 261)` (#2f6fe0) |
| `--secondary`, `--muted`, `--accent`, `--input`, `--sidebar-accent` | `oklch(0.939 0.007 97)` (#ecebe6) |
| `--muted-foreground` | `#6b6963` |
| `--border`, `--sidebar-border` | `oklch(0.919 0.008 91)` (#e6e4de) |
| `--sidebar` | `oklch(0.948 0.007 97)` (#efeee9) |
| `--accent-soft` | `oklch(0.932 0.027 262)` (#dfe9fb) |
| `--good` | `oklch(0.569 0.119 155)` (#2e8b57) |
| `--bad`, `--destructive` | `oklch(0.588 0.150 40)` (#c4572f) |
| `--band` | `linear-gradient(180deg, #cfe2fb 0%, #e9f1fb 55%, #f4f3ef 100%)` |

  Leave `--chart-2` to `--chart-5` as they are. In the same block, set `font-family: var(--font-ui), ui-sans-serif, system-ui, sans-serif` on `body`. The `@layer base` body gradient is dark-tuned, so set `background-image: none` on the body for Sky.

- [ ] **Step 4: Add the theme vars and the label utility**

  In `@theme inline`, add:
  - `--color-good: var(--good)`
  - `--color-bad: var(--bad)`
  - `--color-accent-soft: var(--accent-soft)`
  - `--font-serif: var(--font-newsreader), Georgia, serif`
  - `--font-label: var(--font-plex-mono), ui-monospace, monospace`

  In `@layer utilities`, add `.label-mono { font-family: var(--font-plex-mono), ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 500; }`.

- [ ] **Step 5: Load IBM Plex Mono in `src/app/layout.tsx`**

  Call `IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" })` and add its `.variable` to the `<html>` className. Add `"500"` to Newsreader's weights, because the brief and headlines use 400 and 500.

- [ ] **Step 6: Mark the app shell in `src/app/(app)/layout.tsx`**

  Wrap the `<SidebarProvider>` subtree in `<div data-app-theme="sky" className="contents">`. The `contents` class keeps it out of the layout.

- [ ] **Step 7: Run the tests and confirm they pass**

  Run `npm run test:e2e`. Everything should pass in both browsers. Then look at `/dashboard` in a demo session. Old dark-tuned components will look rough on light, and that is expected because Phases 1 to 5 replace them. But nothing may be unreadable: no white-on-white text. List any spots you find in the PR description.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/app/layout.tsx "frontend/src/app/(app)/layout.tsx" frontend/e2e/foundations.spec.ts
git commit -m "feat: Sky light theme scoped to the app shell, label/serif type roles"
```

---

### Task 3: Motion foundation (one library, shared timings, reduced motion)

**Files:**
- Create: `frontend/src/lib/motion.ts`
- Modify: the 7 files in `frontend/src/components/ai-analytics/` that import `framer-motion`; `frontend/src/app/(app)/layout.tsx`; `frontend/src/app/globals.css`; `frontend/package.json`
- Test: `frontend/e2e/foundations.spec.ts`

**Interfaces:**
- Produces, in `@/lib/motion`:
  - `export const DURATION = { fast: 0.15, base: 0.2, slow: 0.25 } as const` (seconds, motion-style)
  - `export const EASE_OUT = [0.22, 1, 0.36, 1] as const`
  - `export const fadeUp = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: DURATION.base, ease: EASE_OUT } }`
  - Later phases import only these.

- [ ] **Step 1: Write the failing test**

```ts
test("reduced motion kills transitions", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/dev/layout-shift");
  const d = await page.getByTestId("transition-probe").evaluate((e) => parseFloat(getComputedStyle(e).transitionDuration));
  expect(d).toBeLessThan(0.01);
  await ctx.close();
});
```

  Playwright's `browser` fixture has no `baseURL` in a new context. Pass `baseURL` to `newContext` from `test.info().project.use.baseURL`.

- [ ] **Step 2: Run it and confirm it fails**

  Run `npm run test:e2e -- -g "reduced motion"`. The expected result is FAIL, with a duration of 0.2.

- [ ] **Step 3: Add the global reduced-motion rule to `globals.css`**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 4: Create `src/lib/motion.ts` with the Interfaces exports**

  In `(app)/layout.tsx`, wrap the shell children in `<MotionConfig reducedMotion="user">`, imported from `motion/react`.

- [ ] **Step 5: Swap the library**

  Replace `from "framer-motion"` with `from "motion/react"` in the 7 `ai-analytics` files. The API is the same. Then run `npm uninstall framer-motion`.

- [ ] **Step 6: Verify**

  Run each of these:
  - `npm run test:e2e`: all tests pass.
  - `npx tsc --noEmit`: no errors.
  - `npm run lint`: clean.
  - `npm run build`: succeeds, and `/dev/layout-shift` returns 404 in `npm start`.
  - `grep -r "framer-motion" src package.json`: no output.

- [ ] **Step 7: Update `docs/CODEBASE-GUIDE.md`, then commit**

  Add three things to the guide:
  - How the theme scope works: `data-app-theme="sky"` and `:root:has(...)`.
  - The harness route and `npm run test:e2e`.
  - The `@/lib/motion` constants.

```bash
git add frontend docs/CODEBASE-GUIDE.md
git commit -m "feat: single motion library, shared timings, reduced-motion support"
```

---

### Task 4: Ship Phase 0

- [ ] **Step 1:** Push the branch, for example `ui-revamp/phase0-foundations` cut from `refactor`. Open a PR into `refactor` with the spec, this plan and the mockup files. In the description, list the tests and their output, plus the before and after of the manual profile-menu check.
- [ ] **Step 2:** Add a STAR entry to `docs/direction/STORY.md`. Situation: overlays shifted content app-wide. Result: 10/10 overlay shift checks pass in two browsers.

---

## Later phases (each gets its own plan when we reach it)

| Phase | Plan file (to write) | Depends on |
|---|---|---|
| 1 App shell: sidebar IA, icon-rail collapse + Ctrl/⌘B, avatar menu, redirects | `…-phase1-shell.md` | Phase 0 tokens and type |
| 2 Home UI from the mockup, empty states for new cards | `…-phase2-home-ui.md` | Phase 1 shell |
| 3 Home backend: summary + "Lumen found", activity, budget + `set_budget` proposals | `…-phase3-home-backend.md` | Phase 2 card contracts |
| 4 Ask Lumen: chat threads (migration), fresh chat + history, handoff, "Next:" fix | `…-phase4-ask.md` | Phase 1 shell |
| 5 Inner pages, with a mockup round each | per page | Phases 1–2 |
| 6 Performance with measured before/after | `…-phase6-perf.md` | all |
