# Night dark mode: foundation and /home pilot, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a local-only switch, make the signed-in app render in the Night theme, with `/home` finished to the spec and Sky unchanged.

**Architecture:** Night is a third value of `data-app-theme`, with tokens in a new `night.css`. Pages already read tokens, so most of the work is the token file. Night-only tweaks in shared components use Tailwind's `dark:` variant, which is on in Night and off in Sky. Where Sky and Night need different colours from one component, a small new token gets a Sky value equal to today's behaviour.

**Tech Stack:** Next.js 14, Tailwind v4, Playwright (`frontend/e2e`, local-only).

**Spec:** `docs/superpowers/specs/2026-11-05-dark-mode-design.md`

## Global Constraints

- Production stays on Sky: Night only when `NEXT_PUBLIC_APP_THEME=night`.
- Sky must look identical. Every new token's Sky value reproduces today's output, and every Night tweak is behind `dark:` or `night.css`.
- No violet glow, gradient or tinted card. Labels are sentence case.
- Text passes AA (4.5:1) on the surface it sits on; `#6a6b6b` is never used for text.
- Press feedback 120 ms at scale 0.97; hover colour 150 ms. Reduced motion keeps working through the existing `globals.css` rule.
- Git: no stacked PRs (PR targets `refactor`). No PR until the owner has seen `/home` and approved it.

## Review Focus

1. Sky regressing through a shared component: the whole existing e2e suite must still pass (Task 4).
2. Portaled menus and dialogs missing the theme, since they mount outside the app shell: pinned in Task 1.
3. Calendar cells unreadable at low or high spend: pinned in Task 3.
4. The loading skeleton changing a card's height in Night, because the figures changed size: pinned in Task 2.
5. Worst-case data (huge amounts, long vendor names) breaking the new sizes: the `break-ui` pass in Task 4.

---

### Task 1: The switch and Night tokens

**Files:**
- Create: `frontend/src/lib/app-theme.ts`, `frontend/src/app/night.css`, `frontend/e2e/night.spec.ts`
- Modify: `frontend/src/components/app-shell.tsx:32`, `frontend/src/app/(app)/layout.tsx:6`, `frontend/src/app/globals.css` (import, Sky token additions), `frontend/.env.example`, `docs/CODEBASE-GUIDE.md`

**Interfaces:**
- Produces: `APP_THEME: "sky" | "night"`; tokens `--series`, `--series-forecast`, `--heat`, `--heat-max`, `--heat-ink-strong`, `--heat-ink-soft` in both themes; test helpers `night(page)`, `rgb(page, css)`, `ratio(a, b)` in `night.spec.ts`.

- [ ] **Step 1: Install dependencies**

Run: `npm ci` in `frontend/`. Expected: completes without errors (the worktree has no `node_modules`).

- [ ] **Step 2: Write the failing tests in `e2e/night.spec.ts`**

`night(page)` runs `document.querySelector("[data-app-theme]").setAttribute("data-app-theme", "night")`. This tests the CSS without a second dev server. Copy `rgb` and `ratio` from `foundations.spec.ts`. All tests use `/dev/layout-shift`:

- `night tokens apply`: body background is `[11, 11, 12]`, `colorScheme` is `dark`.
- `portaled menu is night`: click `open-dropdown`, then `[role="menu"]` background is `[35, 35, 37]`.
- `muted text meets AA everywhere`: `--muted-foreground` is ≥ 4.5 against each of `--background`, `--card`, `--popover`, `--sidebar`.
- `bui tokens follow night`: `bui-probe` background is `[11, 11, 12]`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx playwright test e2e/night.spec.ts`. Expected: FAIL (no Night tokens yet).

- [ ] **Step 4: Implement**

- `lib/app-theme.ts`: `export const APP_THEME = process.env.NEXT_PUBLIC_APP_THEME === "night" ? "night" : "sky";`
- `app-shell.tsx`: `data-app-theme={APP_THEME}`.
- `(app)/layout.tsx`: Night viewport `{ themeColor: "#0b0b0c", colorScheme: "dark" }`, otherwise today's value.
- `night.css`: the spec's two token blocks verbatim, plus `:root:has([data-app-theme="night"]) { scrollbar-gutter: stable; }` and a body rule setting `font-family: var(--font-ui), ui-sans-serif, system-ui, sans-serif; background-image: none;`.
- `globals.css`: `@import "./night.css";` after the `beautiful-ui.css` import. In the Sky block add `--series: var(--primary); --series-forecast: var(--primary); --heat: var(--primary); --heat-max: 100%; --heat-ink-strong: #fff; --heat-ink-soft: var(--muted-foreground);`.
- `.env.example`: a commented `NEXT_PUBLIC_APP_THEME=night` line saying it's local only.
- `CODEBASE-GUIDE.md`: one line on the switch and `night.css`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx playwright test e2e/night.spec.ts e2e/foundations.spec.ts`. Expected: all PASS.

- [ ] **Step 6: Check the real switch once**

Run the dev server with `NEXT_PUBLIC_APP_THEME=night` and request `/home` with the cookie `lumen_session=1`. Expected: the HTML contains `data-app-theme="night"` and `<meta name="theme-color" content="#0b0b0c"/>`.

- [ ] **Step 7: Commit**

`feat: add the Night theme tokens behind a local-only switch`, including the spec and this plan.

### Task 2: Cards, type and press feedback

**Files:**
- Modify: `frontend/src/components/page/page-card.tsx:34`, `frontend/src/components/page/page-header.tsx:19`, `frontend/src/app/(app)/home/_components/{spend-card,budget-card,calendar-card,brief,lumen-found}.tsx`, `frontend/src/app/night.css`
- Test: `frontend/e2e/night.spec.ts`

**Interfaces:**
- Consumes: `night(page)`, `rgb`, `ratio`; `signIn` from `e2e/fixtures.ts`.

- [ ] **Step 1: Write the failing tests** (on `/home`, with `signIn` and a one-transaction fixture)

- `cards are flat`: `spend-card` has `boxShadow` `none`.
- `pages have no band`: `sky-band` has `backgroundImage` `none`.
- `greeting is the serif`: the `h1` `fontFamily` matches `/Newsreader/i` and `fontWeight` is `300`.
- `figures are regular weight and tabular`: the hero figure inside `spend-card` has `fontWeight` `400`, `fontVariantNumeric` containing `tabular-nums`.
- `pressing a button gives feedback`: `mouse.down` on the `1W` range button makes computed `scale` `0.97`.
- `a spike icon stays readable`: with `summary.found` holding one `spike` item, the icon's colour is ≥ 3 against `--card`.
- `loading does not change card height`: with `delayMs: 1500`, `spend-card` height is the same while its skeleton shows and after it's gone.

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test e2e/night.spec.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- `PageCard`: add `dark:shadow-none dark:border-border`.
- `PageHeader` `h1`: add `dark:font-display dark:text-[34px] dark:font-light dark:tracking-[-0.01em]`.
- Hero figure in `spend-card`: `dark:text-[34px] dark:font-normal`.
- Calendar and budget figures: `dark:text-[24px] dark:font-normal`.
- `brief.tsx` skeleton: `dark:bg-white/5`.
- `lumen-found.tsx` spike tint: add `dark:text-[#f5a35c]`.
- `night.css`: on `button, a[role="button"]` set `transition: scale 120ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms ease, color 150ms ease, border-color 150ms ease`, and on `:active:not(:disabled)` set `scale: 0.97`, both scoped to Night.

- [ ] **Step 4: Run to verify they pass**

Run: `npx playwright test e2e/night.spec.ts`. Expected: all PASS.

- [ ] **Step 5: Commit**

`feat: flat cards, Night type and press feedback`

### Task 3: Chart lines and calendar heat

**Files:**
- Modify: `frontend/src/components/page/cumulative-chart.tsx:97-116`, `frontend/src/app/(app)/home/_components/spend-card.tsx:92,101`, `frontend/src/app/(app)/home/_components/calendar-card.tsx:80`, `frontend/src/app/(app)/home/_components/budget-card.tsx:60`
- Test: `frontend/e2e/night.spec.ts`

**Interfaces:**
- Consumes: `--series`, `--series-forecast`, `--heat`, `--heat-max`, `--heat-ink-strong`, `--heat-ink-soft`.

- [ ] **Step 1: Write the failing tests** (`forecastFixture` for the forecast line)

- `running total is cyan, forecast is violet`: `[data-series="current"]` `stroke` is `[0, 179, 221]`, `[data-series="forecast"]` is `[164, 158, 255]`.
- `calendar text is readable at any spend`: with one day at ₹50,000 and one at ₹100 this month, each `cal-day-N` has text ≥ 4.5 against its background composited over `--card` (draw both on the helper's canvas).
- `sky calendar is unchanged`: without `night(page)`, the top-spend cell's text is `rgb(255, 255, 255)` and its background still mixes `--primary`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test e2e/night.spec.ts`. Expected: the Night tests FAIL (the line is white, heat is white on white).

- [ ] **Step 3: Implement**

- `cumulative-chart.tsx`: the fill stops, current line, today's dot and today's rule use `var(--series)` (dot: `bg-[var(--series)]`). The forecast path and band use `var(--series-forecast)`. The "Today" tick stays `text-primary`.
- `spend-card.tsx` legend: `border-[var(--series)]` and `border-[var(--series-forecast)]/60`.
- `budget-card.tsx:60`: `bg-primary` becomes `bg-[var(--series)]`.
- `calendar-card.tsx:80`: `style={h ? { background: \`color-mix(in srgb, var(--heat) calc(var(--heat-max) * ${h.toFixed(2)}), transparent)\`, color: h > 0.5 ? "var(--heat-ink-strong)" : "var(--heat-ink-soft)" } : undefined}`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx playwright test e2e/night.spec.ts`. Expected: all PASS.

- [ ] **Step 5: Commit**

`feat: Night chart lines and neutral calendar heat`

### Task 4: Night's own icons, numbers and motion

Owner request (2026-11-05): dark mode gets its own click response, animations and page transitions, and icons with more taste than Lucide, from designeer.xyz's catalogue. Rules also draw on Emil's skills and Vercel's Web Interface Guidelines.

**Files:**
- Create: `frontend/src/components/icons.tsx`, `frontend/e2e/night-build.spec.ts`
- Modify: `frontend/package.json`, `frontend/playwright.config.ts` (pass `NEXT_PUBLIC_APP_THEME` through), `frontend/src/app/night.css`, `frontend/src/app/(app)/home/_components/{spend-card,lumen-found}.tsx`, `frontend/src/components/{app-sidebar,ask-palette,avatar-menu,uploadDialog,exportDialog}.tsx`, `frontend/src/components/ui/{dialog,dropdown-menu,select,sheet,sidebar}.tsx`
- Test: `frontend/e2e/night.spec.ts`, `frontend/e2e/night-build.spec.ts`

**Interfaces:**
- Consumes: `APP_THEME` from Task 1.
- Produces: `components/icons.tsx` exports each icon under its Lucide name plus `type LucideIcon`, picked at build time: Lucide in Sky, Phosphor (`regular` weight) in Night.

- [ ] **Step 1: Write the failing tests**

In `night.spec.ts` (attribute flip):
- `page change uses the night transition`: `.app-page-in` has `animationName` `night-page-in` and duration `0.2s`.
- `menus open fast, close faster`: open `[role="menu"]` has `animationDuration` `0.16s`; a floating menu has a `boxShadow` that isn't `none`.
- `keyboard focus is visible`: tabbing to a button gives `outlineStyle` `solid` and `outlineWidth` `2px`.
- `reduced motion drops the page slide`: with `reducedMotion: "reduce"`, `.app-page-in` has `animationName` `none`.

In `night-build.spec.ts`, skipped unless `NEXT_PUBLIC_APP_THEME=night`:
- `sidebar icons are Phosphor`: the sidebar's first `svg` has `viewBox` `0 0 256 256`.
- `hero figure uses NumberFlow`: `spend-card` contains a `number-flow-react` element, and its accessible text holds the formatted amount.
- `switching range rolls the figure without moving the card`: after clicking `1W`, `spend-card`'s height is unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test e2e/night.spec.ts`, then the same for `night-build.spec.ts` with the env set. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- `npm i @phosphor-icons/react @number-flow/react`. Both are MIT and listed on designeer.xyz.
- `icons.tsx`: `APP_THEME === "night" ? phosphorWrapper : Lucide` per icon, dropping `strokeWidth`, default `size={24}` so existing `size-*` classes still decide the size.
- Swap the listed files' `lucide-react` imports to `@/components/icons`. The other pages move in the rollout plan.
- `spend-card.tsx`: in Night only, `NumberFlow` replaces `CountUp`.
- `night.css`: `--ease-out`; `@keyframes night-page-in` (opacity, `translateY(6px)`, `blur(2px)`, 200 ms, only under `prefers-reduced-motion: no-preference`); overlay contents 160 ms open and 110 ms closed, dialogs 220 ms; a two-layer floating shadow; `:focus-visible` 2 px `--ring` outline, offset 2 px; `::selection`.
- `ask-palette`: no open animation in Night (keyboard-first).

- [ ] **Step 4: Run to verify they pass**

Run both specs as in Step 2. Expected: all PASS.

- [ ] **Step 5: Commit**

`feat: Night's own icons, rolling figures and motion`

### Task 5: Look at it, and owner sign-off

**Files:** whatever the review turns up, in `night.css` or `dark:` classes only.

- [ ] **Step 1: Run the full suite for Sky**

Run: `npx playwright test`. Expected: the same pass count as before this work, with no new failures. If any test already fails on the base commit, say so rather than hide it.

- [ ] **Step 2: Render `/home` in Night**

Run the app with `NEXT_PUBLIC_APP_THEME=night` and the demo or fixture data. Screenshot it next to the landing's `SpendingMock`, `BudgetMock` and `SubscriptionsMock`. Check the "my call" values: sidebar colour, and hairlines at `/60` opacity, which may be too faint on `--border`. Also check the sidebar, avatar menu, upload dialog and export dialog.

- [ ] **Step 3: Stress and motion passes**

Run the `break-ui` skill on `/home` for worst-case data, and `review-animations` on the press and hover rules. Fix what they find in `night.css` or `dark:` classes.

- [ ] **Step 4: Record the numbers**

Add a short entry to `docs/direction/STORY.md`: the contrast and palette failures found in the mockups, and how they were fixed.

- [ ] **Step 5: Commit and show the owner**

`fix: Night review pass on /home`. Send screenshots. The PR into `refactor` waits for the owner's approval.

### Task 6: Every other page (added 2026-11-05)

The owner asked for work to continue overnight on anything not blocked on them, so the rollout happened before sign-off. It stays behind the switch.

- All icon imports moved to `@/components/icons`, with a bundle-time swap so a Sky build never loads Phosphor or NumberFlow.
- Legends and data marks use `--series`; `by-category.tsx` uses `--category-*`, whose Sky values are the old hex colours.
- `night.css` handles the leftovers: amber text, `bg-white/50` skeletons, toggle knobs, the file picker and page hero type.
- The error page reads its theme from `APP_THEME`; visible emoji are gone.
