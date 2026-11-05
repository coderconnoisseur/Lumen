# Night: Lumen's dark mode (draft)

Status: approved by the owner 2026-11-05, nothing built yet. Values marked "my call" are guesses to check in the browser.

## Intent

The signed-in app should look like the product screens on the landing page. Those mockups (`components/home/mocks.tsx`, `chat-demo.tsx`, `proposal-demo.tsx`) are the visual target. Apple's and Emil Kowalski's principles decide how it behaves. If they conflict, the mockups win on looks and the behaviour rules win on feel.

Night is built separately from Sky (light) and stays out of production until the owner likes it. Anything good can move to Sky later.

**Non-goals:** matching Sky, a user-facing theme toggle, changing the landing page, changing production.

**It has failed if:** it looks like an Apple clone, it reads as an AI-generated site (violet glows, violet gradients), the numbers are harder to read than in Sky, or it only looks right on sample data.

## What the mockups do

| Observation | Where | Rule it gives us |
| --- | --- | --- |
| The app screen sits on `#0b0b0c`, panels on `#18181a`, raised on `#232325`, the bubble on `#2a2a2c` | `ChatDemo`, `Panel`, `ChecksMock` | Depth comes from a short ladder of neutrals |
| Borders are white at 6–10%, with no shadows on in-flow cards | `Panel` and most mocks | Hairlines, not shadows |
| Shadows only on the phone and the notification stack | `Phone`, `Notifications` | Shadow means "floating" |
| The main action is a white pill with black text; the secondary is white at 10% | `ProposalDemo`, `ChatDemo`, `Cta` | White is the primary action, not violet |
| Violet only on the sparkle, the forecast, the AI summary and the Lumen orb | `Panel`, `ForecastMock`, `GuideMock` | Violet means "Lumen is speaking" |
| Green, red and orange appear as small dots, tinted chips or one short phrase | `SpendingMock`, `InsightRow`, `ChecksMock` | Status colour stays small; numbers stay white |
| Big sans figures with tight tracking, with a small muted caption | every mock | The number is the hero of a card |
| Serif appears on greetings and suggestion titles, never on data | `ChatDemo`, `ProposalDemo`, `GuideMock` | Newsreader speaks, Funnel Sans reports |
| Glass only over photos | `HeroPhone`, `ProposalDemo` | No glass on the app's flat canvas |
| A proposal's states share one grid cell and crossfade | `ProposalDemo` | No layout shift |

## Principles

1. **One ladder of depth.** Page, card, raised, floating, each one step lighter. Never add a border and a shadow to fix a weak step.
2. **The number comes first.** One figure per card leads. Everything else recedes. Figures use `tabular-nums`.
3. **White acts, violet speaks, colour reports.** White is what you press. Violet marks Lumen's voice, only as small accents (the sparkle, a label, the forecast line), never as a glow, gradient or tinted card. Green, red and orange only report state, always with a word or icon beside them.
4. **One white button per view.** Everything else is quiet.
5. **Materials only when something floats.** Blur is for menus, sheets and sticky bars. Cards and tables stay solid. Respect `prefers-reduced-transparency`.
6. **Motion has to say something.** Press feedback, state changes and where a thing came from. Data never bounces, and anything opened from the keyboard (Ctrl+K) appears instantly.
7. **App speed, not landing speed.** The landing's 500 ms–1.2 s stays on the landing. In the app, nearly everything is under 250 ms.
8. **Nothing shifts.** States crossfade in reserved space, as `ProposalDemo` already does.
9. **Measured, not eyeballed.** Text passes AA on every surface it sits on, and chart colours pass the dataviz validator.

## Tokens

### Surfaces and text

Mapped onto the two token sets the app already reads, so most pages need no class changes.

```css
:root:has([data-app-theme="night"]) {
	color-scheme: dark;
	--background: #0b0b0c;
	--foreground: #f5f5f7;
	--card: #18181a;
	--card-foreground: #f5f5f7;
	--popover: #232325;
	--popover-foreground: #f5f5f7;
	--primary: #ffffff;
	--primary-foreground: #000000;
	--secondary: #2a2a2c;
	--secondary-foreground: #f5f5f7;
	--muted: #1f1f21;
	--muted-foreground: #8a8a8c;
	--accent: #232325;
	--accent-foreground: #f5f5f7;
	--destructive: #f87171;
	--destructive-foreground: #0b0b0c;
	--border: rgb(255 255 255 / 0.06);
	--input: rgb(255 255 255 / 0.1);
	--ring: #a49eff;
	--sidebar: #0e0e0f; /* my call */
	--sidebar-foreground: #f5f5f7;
	--sidebar-primary: #ffffff;
	--sidebar-primary-foreground: #000000;
	--sidebar-accent: #1f1f21;
	--sidebar-accent-foreground: #f5f5f7;
	--sidebar-border: rgb(255 255 255 / 0.06);
	--sidebar-ring: #a49eff;
	--accent-soft: #232325; /* neutral: no violet-tinted cards */
	--series: #00b3dd; /* the running-total line */
	--series-forecast: #a49eff;
	--heat: #ffffff; /* calendar cells: neutral, up to 22% white, always light text */
	--heat-max: 22%;
	--heat-ink-strong: #f5f5f7;
	--heat-ink-soft: #f5f5f7;
	--good: #4ade80;
	--bad: #f87171;
	--band: none; /* owner: no violet glow, pages are plain near-black */
	--chart-1: #0091b5;
	--chart-2: #d9608f;
	--chart-3: #847dff;
	--chart-4: #b8860b;
	--chart-5: #2f9e8f;
}

:root:has([data-app-theme="night"]) .bui {
	--page: #0b0b0c;
	--canvas: #050505;
	--surface: #18181a;
	--inset: #111112;
	--hover: #232325;
	--hover-2: #2a2a2c;
	--ink: #f5f5f7;
	--ink-2: #b4b4b6;
	--ink-3: #8a8a8c;
	--line: rgb(255 255 255 / 0.06);
	--line-strong: rgb(255 255 255 / 0.12);
	--field: #161617;
	--accent: #847dff;
	--accent-ink: #a49eff;
	--accent-tint: rgb(132 125 255 / 0.16);
	--green: #4ade80;
	--green-tint: rgb(74 222 128 / 0.1);
	--orange: #f5a35c;
	--orange-tint: rgb(245 163 92 / 0.1);
	--red: #f87171;
	--red-tint: rgb(248 113 113 / 0.1);
}
```

### Measured contrast

WCAG ratios, computed from the hex values. AA for normal text is 4.5.

| Text | Page `#0b0b0c` | Card `#18181a` | Raised `#232325` | Bubble `#2a2a2c` | Use |
| --- | --- | --- | --- | --- | --- |
| `#f5f5f7` | 18.07 | 16.28 | 14.41 | 13.16 | Primary |
| `#b4b4b6` | 9.50 | 8.57 | 7.58 | 6.92 | Secondary |
| `#8a8a8c` | 5.71 | 5.15 | 4.55 | **4.16** | Muted, not on the bubble |
| `#6a6b6b` | **3.68** | **3.32** | **2.93** | **2.68** | Decoration only |
| `#5a5a5c` | **2.86** | **2.58** | **2.28** | **2.08** | Dropped |

The mockups use `#6a6b6b` and `#5a5a5c` for real text (axis ticks, weekday letters, the disclaimer). That fails AA, so in the app that text moves up to `#8a8a8c`. This is a deliberate difference from the mockups.

### Charts

The mockups' bright colours fail the validator on `#18181a`: all are too light for its dark band, teal and pink are hard to tell apart with deuteranopia, and violet and cyan are too close even with full colour vision.

- **Single-series lines keep the mockup colour:** `#00b3dd` at 2–2.5 px, with an area fill fading from 35% to 0.
- **Multi-series uses the re-stepped order above:** `#0091b5, #d9608f, #847dff, #b8860b, #2f9e8f`. It has no hard failures, but its colourblind separation is in the validator's warning band, so those charts need direct labels or a legend. Six or more categories fold into "Other".
- **Actual vs forecast:** actual uses the same `#00b3dd` line (one chart component draws every page's running total), forecast `#a49eff` dashed, comparison white at 25–30% dashed.
- **Grid** white at 5%. **Axis text** `#8a8a8c`.
- **Status colours** stay out of the series palette, since green and red already mean good and bad.

### Type

| Role | Font | Size and weight | Details |
| --- | --- | --- | --- |
| Page greeting or title | Newsreader | 28–52 px, 300 | Tracking -0.01em, leading 1.05–1.1 |
| Hero figure | Funnel Sans | 30–34 px, 400 | Tracking -0.025em, tabular, leading 1 |
| Stat figure | Funnel Sans | 20–24 px, 400 | Tracking -0.025em, tabular |
| Card title or label | Funnel Sans | 12.5 px, 500 | `.label-ui`, sentence case |
| Body or row | Funnel Sans | 13–15 px, 400 | Leading 1.45–1.55 |
| Caption | Funnel Sans | 11–12 px, 400 | Nothing smaller than 11 px |

The mockups' `9.5–10.5 px` uppercase tracked labels are not carried over. They break the owner's sentence-case rule of 2026-10-22, and they're too small for a working app.

### Shape and elevation

| Token | Value | From |
| --- | --- | --- |
| Card radius | 16 px (18 px on large hero cards) | `Panel`, `InsightRow` |
| Inner block radius | 12 px | Tables and calendar in the mocks |
| Control radius | 8 px | Rows and icon buttons |
| Buttons and chips | Pill | `ProposalDemo`, `Cta` |
| Floating shadow | `0 24px 60px rgb(0 0 0 / 0.45)` plus a white 9% border | `Notifications` |
| Floating material | Up to `blur(24px)` over a translucent page colour | The landing's nav bar |

### Motion

| Use | Duration | Easing or spring |
| --- | --- | --- |
| Press on anything pressable, except full-width rows, which change background instead | 120 ms, `scale(0.97)` | `--ease-out` |
| Hover colour | 150 ms, on pointer devices only | `ease` |
| Tooltip, small popover | 125–160 ms, from `scale(0.97)` | `--ease-out`, origin at the trigger |
| Menu, select | 160–200 ms, from `scale(0.96)` | `--ease-out`, origin at the trigger |
| Dialog | 200–240 ms, centred | `--ease-out` |
| Mobile sheet | Spring, `bounce: 0`, `0.35 s` | Interruptible |
| State crossfade | 200–250 ms | `--ease-out`, reserved space |
| Page change | 160 ms | Existing `.app-page-in` |
| Ctrl+K palette, keyboard actions | None | None |
| Hero figure | Digits roll to each new value (range or month switch) | NumberFlow, honours reduced motion |
| Charts | Draw once at most, never replay on filter | None |

`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` is what the landing already uses, and it's nearly the same as Emil's recommended curve, so we keep it. With reduced motion, slides become short fades and the existing `globals.css` rule still applies.

## Which mock becomes which component

| Mock | Real surface |
| --- | --- |
| `Panel` | The base card with a header |
| `SpendingMock` | Home hero chart, Spending |
| `BudgetMock` | Budget card and page |
| `SubscriptionsMock` | Home calendar, Bills |
| `InvoiceMock` | Receipts |
| `ForecastMock` | Forecast |
| `InsightRow` card | Stat tile, static instead of a marquee |
| `GuideMock` cards | AI summary and top action, on a plain card (the mock's violet gradient is dropped) with a violet label |
| `ProposalDemo` | Proposal card: same layout and states, plain card instead of glass, violet "Lumen suggests" label |
| `ChatDemo` | Ask Lumen |
| `Notifications` | Toasts and alerts |

## Keeping it out of production

- A one-line switch in `components/app-shell.tsx`: `data-app-theme` becomes `night` only when `NEXT_PUBLIC_APP_THEME=night`. Production never sets it, so production stays on Sky.
- Tokens go in a new `frontend/src/app/night.css`, leaving the Sky values alone.

## Code that has to change for Night to work

- `home/_components/calendar-card.tsx:80` mixes `--primary` for the heat cells with white text. With a white primary, that becomes white on white. It needs its own colour.
- `spending/_components/by-category.tsx:6` hardcodes Sky's category colours.
- `(app)/layout.tsx:6` hardcodes the light `themeColor` and `colorScheme`.
- `globals.css` scopes the body font, background reset and `scrollbar-gutter` to Sky. They need a Night equivalent.
- `--band` sits behind six page headers (home, budget, bills, receipts, spending, forecast). Night sets it to `none`, so no page code changes.
- Anything using `bg-primary` as a highlight rather than an action turns white. Audit this during the pilot.

## Pilot

Build `/home` first. It covers the hero chart, calendar and budget card, so most mock patterns get tested at once. Compare it side by side with the mocks, run `break-ui` for worst-case data, then `review-animations`. Only then roll out to the other pages.

## Owner decisions (2026-11-05)

- **Labels:** sentence case.
- **Page band:** no violet glow, because it reads as AI-generated. Pages are plain near-black.

## Not verified yet

Nothing has been rendered in the real app; `node_modules` isn't installed in this worktree. The "my call" values and the chart order have never been seen on a real page.
