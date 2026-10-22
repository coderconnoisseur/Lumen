import { test, expect, type Page } from "@playwright/test";
import { signIn, type HomeFixture } from "./fixtures";

// Dates relative to the real "today" so the Home's period maths sees them in this / last month.
const now = new Date();
export const ymd = (y: number, m: number, d: number) => {
	const x = new Date(y, m, d);
	return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const Y = now.getFullYear();
const M = now.getMonth();
export const thisMonth = (day: number) => ymd(Y, M, day);
export const lastMonth = (day: number) => ymd(Y, M - 1, day);
export const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const tx = (id: string, vendor_name: string, date: string, total_amount: number, category = "Food") => ({
	id,
	vendor_name,
	date,
	total_amount,
	category,
	created_at: hoursAgo(48),
});

// 18,412 so far this month vs 20,280 by the same day last month → "9% lighter"
export const typical: HomeFixture = {
	txns: [tx("a", "Swiggy", thisMonth(1), 18412), tx("b", "Rent", lastMonth(1), 20280)],
};

export async function openHome(page: Page, home: HomeFixture = typical, reviewCount = 0) {
	await signIn(page, { home, reviewCount });
	await page.goto("/home");
}

test("home greets and briefs", async ({ page }) => {
	await openHome(page);
	await expect(page).toHaveTitle(/^Home/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), E2E$/);
	await expect(page.getByTestId("brief")).toContainText("lighter than");
});

test("app pages set a light theme-color", async ({ page, request }) => {
	await openHome(page);
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f4f3ef");
	const login = await (await request.get("/login")).text();
	expect(login.includes('<meta name="theme-color" content="#050505"/>'), "login keeps the dark bar").toBe(true);
});

test("home has no layout shift while loading", async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { cls: number }).cls = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
				if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
		}).observe({ type: "layout-shift", buffered: true });
	});
	await openHome(page, { ...typical, delayMs: 1500 });
	await expect(page.getByTestId("brief")).toContainText("lighter than", { timeout: 15_000 });
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.01);
});

test("old dashboard is gone", async ({ page }) => {
	await openHome(page);
	await expect(page.getByTestId("brief")).toBeVisible();
	await expect(page.getByText("Financial Overview")).toHaveCount(0);
	await expect(page.getByText("What to watch")).toHaveCount(0);
});

const spend = (page: Page) => page.getByTestId("spend-card");
const prevLong = new Date(Y, M - 1, 1).toLocaleString("en-US", { month: "long" });
const monthLong = new Date(Y, M, 1).toLocaleString("en-US", { month: "long" });
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const lastDay = new Date(Y, M + 1, 0).getDate();

test("spend card shows total and delta", async ({ page }) => {
	await openHome(page);
	await expect(spend(page).getByText("₹18,412", { exact: true })).toBeVisible();
	await expect(spend(page).getByTestId("spend-delta")).toHaveText(`−₹1,868 (9%) vs ${prevLong} by the ${ord(now.getDate())}`);
});

test("range chips switch period", async ({ page }) => {
	await openHome(page);
	await expect(spend(page)).toContainText(`Spent in ${monthLong}`);
	await expect(spend(page).getByRole("link", { name: new RegExp(`Spent in ${monthLong}`) })).toHaveAttribute("href", "/spending");
	await spend(page).getByRole("button", { name: "1W" }).click();
	await expect(spend(page)).toContainText("Spent this week");
	await expect(spend(page).getByRole("button", { name: "1W" })).toHaveAttribute("aria-pressed", "true");
});

test("chart survives a failed forecast", async ({ page }) => {
	await openHome(page, { ...typical, forecast: "fail" });
	await expect(spend(page).locator('[data-series="current"]')).toHaveCount(1);
	await expect(spend(page).locator('[data-series="forecast"]')).toHaveCount(0);
});

test("forecast draws to month end", async ({ page }) => {
	test.skip(now.getDate() === lastDay, "no future days left this month");
	const dates = Array.from({ length: 31 }, (_, i) => ymd(Y, M, now.getDate() + 1 + i));
	await openHome(page, { ...typical, forecast: { dates, values: dates.map(() => 100) } });
	await expect(spend(page).locator('[data-series="forecast"]')).toHaveCount(1);
	// 18,412 so far + 100 for each day left in the month
	const left = lastDay - now.getDate();
	await expect(spend(page)).toContainText(`heading for ₹${(18412 + 100 * left).toLocaleString("en-IN")}`);
});

test("bill pins show upcoming bills", async ({ page }) => {
	test.skip(now.getDate() === lastDay, "no future days left this month");
	await openHome(page, {
		...typical,
		reminders: [{ id: "n", vendor: "Netflix", amount: 649, date: thisMonth(now.getDate() + 1), type: "upcoming" }],
	});
	await expect(spend(page).getByTestId("bill-pin")).toHaveAttribute("title", "Netflix");
	await expect(spend(page).getByTestId("bill-pin")).toHaveText("N");
});

test("new user sees empty states", async ({ page }) => {
	await openHome(page, {});
	await expect(page.getByTestId("brief")).toContainText("Nothing spent yet");
	await expect(spend(page)).toContainText("₹0");
	await expect(page.getByText("NaN")).toHaveCount(0);
	await expect(spend(page).getByTestId("spend-delta")).toHaveCount(0);
});

test("changing the chart range never blanks other cards", async ({ page }) => {
	await openHome(page, { ...typical, delayMs: 800 });
	await expect(page.getByTestId("brief")).toContainText("lighter than", { timeout: 15_000 });
	await spend(page).getByRole("button", { name: "1W" }).click();
	await page.waitForTimeout(200); // mid-refetch
	await expect(page.getByTestId("brief")).toContainText("lighter than");
	await expect(spend(page).locator('[data-slot="skeleton"]')).toHaveCount(0);
});

const inDays = (n: number) => ymd(Y, M, now.getDate() + n);

test("lumen found links to review", async ({ page }) => {
	await openHome(page, typical, 2);
	const found = page.getByTestId("lumen-found");
	await expect(found.getByText("2 receipts need a glance")).toBeVisible();
	await expect(found.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/receipts");
});

test("lumen found is honest when there is nothing", async ({ page }) => {
	await openHome(page, typical, 0);
	await expect(page.getByTestId("lumen-found")).toContainText("Nothing needs you right now.");
});

test("calendar shows amounts by day", async ({ page }) => {
	await openHome(page, { txns: [tx("c", "Croma", thisMonth(4), 2210)] });
	await expect(page.getByTestId("cal-day-4")).toContainText("₹2.2k");
});

test("recent transactions list newest first", async ({ page }) => {
	await openHome(page, { txns: [tx("o", "Older", thisMonth(1), 100), tx("n", "Swiggy", thisMonth(2), 200)] });
	await expect(page.getByTestId("recent-row").first()).toContainText("Swiggy");
});

test("long names truncate", async ({ page }) => {
	await openHome(page, {
		txns: [
			tx("l", "Bharat Sanchar Nigam Limited Postpaid Services India", thisMonth(2), 1_500_000, "Bills"),
			tx("s", "Uber", thisMonth(1), 312, "Travel"),
		],
	});
	const rows = page.getByTestId("recent-row");
	await expect(rows).toHaveCount(2);
	const [a, b] = [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox()];
	expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1);
});

test("coming up lists the next four bills", async ({ page }) => {
	const r = (id: string, vendor: string, n: number) => ({ id, vendor, amount: 100, date: inDays(n), type: "upcoming" });
	await openHome(page, {
		...typical,
		reminders: [r("4", "Rent", 9), r("1", "Netflix", 1), r("3", "Gym", 6), r("2", "Spotify", 3), r("5", "Jio", 12), r("6", "LIC", 20)],
	});
	const rows = page.getByTestId("bill-row");
	await expect(rows).toHaveCount(4);
	await expect(rows.first()).toContainText("Netflix");
	const d = new Date(Y, M, now.getDate() + 1);
	await expect(rows.first().getByTestId("date-chip")).toHaveText(`${d.toLocaleString("en-GB", { weekday: "short" })}${d.getDate()}`);
	await expect(page.getByRole("link", { name: /^Coming up/ })).toHaveAttribute("href", "/bills");
});

test("budget card is honest with no budget", async ({ page }) => {
	await openHome(page);
	await expect(page.getByText("No budget yet")).toBeVisible();
	await expect(page.getByRole("link", { name: "Draft budget" })).toBeVisible();
});

test("activity comes from the summary", async ({ page }) => {
	await openHome(page, {
		...typical,
		summary: { found: [], activity: [{ kind: "statement_import", text: "Imported a statement · 42 rows", amounts: [], at: hoursAgo(2) }] },
	});
	await expect(page.getByTestId("activity")).toContainText("Imported a statement · 42 rows");
	await expect(page.getByTestId("activity")).toContainText("2h ago");
});

test("side column order", async ({ page }) => {
	await openHome(page);
	const side = page.getByTestId("home-side");
	await expect(side.locator(":scope > section").first()).toBeVisible();
	const titles = await side.locator(":scope > section").evaluateAll((els) =>
		els.map((e) => (e.querySelector("h2, h3, a")?.textContent ?? "").replace(" ›", "").trim().toLowerCase()),
	);
	expect(titles).toEqual([`budget in ${monthLong.toLowerCase()}`, "coming up", "let lumen draft your budget", "activity"]);
});

test("sky band is drawn behind the greeting", async ({ page }) => {
	await openHome(page);
	const bg = await page.getByTestId("sky-band").evaluate((e) => getComputedStyle(e).backgroundImage);
	expect(bg).toContain("linear-gradient");
});

test("totals include every transaction, not just the first page", async ({ page }) => {
	const many = Array.from({ length: 140 }, (_, i) => tx(`m${i}`, "Kirana", thisMonth(1), 100));
	await openHome(page, { txns: many });
	await expect(spend(page).getByText("₹14,000", { exact: true })).toBeVisible();
});

test("a slow forecast never holds up the rest of Home", async ({ page }) => {
	const forecastReq = page.waitForRequest((r) => r.url().includes("/api/analytics/forecast"));
	await openHome(page, { ...typical, forecastDelayMs: 6000 });
	await expect(page.getByTestId("brief")).toContainText("lighter than", { timeout: 2500 });
	expect((await forecastReq).url()).toContain("insights=0");
});

test("calendar shading works without relative colour syntax", async ({ page }) => {
	await openHome(page, { txns: [tx("c", "Croma", thisMonth(4), 2210)] });
	expect(await page.getByTestId("cal-day-4").getAttribute("style")).toContain("color-mix");
});

test("spend card has a real empty state for a new user", async ({ page }) => {
	await openHome(page, {});
	await expect(spend(page)).toContainText("Nothing spent yet this month");
	await expect(spend(page).locator('[data-series="current"]')).toHaveCount(0);
});

test("a forecast with no matching days draws no line", async ({ page }) => {
	await openHome(page, { ...typical, forecast: { dates: [lastMonth(2), lastMonth(3)], values: [500, 500] } });
	await expect(spend(page).locator('[data-series="current"]')).toHaveCount(1);
	await expect(spend(page).locator('[data-series="forecast"]')).toHaveCount(0);
	await expect(spend(page)).not.toContainText("heading for");
});

const dupe = { kind: "duplicate", tag: "DUPLICATES", headline: "Possible double charge: Croma {0}", detail: "Charged on 14 Oct and 15 Oct.",
	amounts: [2499], worth: 2499, href: null };
const spike = { kind: "spike", tag: "SPENDING", headline: "Food is up 35%", detail: "{0} so far vs {1} by this point last month.",
	amounts: [6750, 5000], worth: null, href: "/spending" };

test("lumen found shows server signals and worth", async ({ page }) => {
	await openHome(page, { ...typical, summary: { found: [dupe, spike], worth_total: 2499 } });
	const found = page.getByTestId("lumen-found");
	await expect(found).toContainText("2 to look at · ₹2,499 you may get back");
	await expect(found.getByTestId("found-row")).toHaveCount(2);
	await expect(found).toContainText("Possible double charge: Croma ₹2,499");
	await expect(found).toContainText("₹6,750 so far vs ₹5,000 by this point last month.");
});

test("brief adds the one thing worth a look", async ({ page }) => {
	await openHome(page, { ...typical, summary: { found: [spike] } });
	await expect(page.getByTestId("brief")).toContainText("The one thing worth a look: Food is up 35%.");
});

test("budget card shows progress against the monthly budget", async ({ page }) => {
	await openHome(page, { ...typical, budget: { monthly_budget: 28000, spent: 18412, categories: [{ category: "Food", limit: 8000, spent: 7480 }] } });
	const card = page.getByTestId("budget-card");
	await expect(card).toContainText("₹18,412 of ₹28,000");
	await expect(card).toContainText("66%");
	await expect(card).toContainText("₹9,588 left");
	await expect(card).toContainText("Food");
	await expect(page.getByText("Let Lumen draft your budget")).toHaveCount(0); // has category budgets already
});

test("budget card says when over", async ({ page }) => {
	await openHome(page, { ...typical, budget: { monthly_budget: 15000, spent: 18412, categories: [] } });
	await expect(page.getByTestId("budget-card")).toContainText("₹3,412 over");
});

test("the draft promo and the budget card lead to the Budget page", async ({ page }) => {
	await openHome(page, typical);
	await expect(page.getByRole("link", { name: "Draft budget" })).toHaveAttribute("href", "/budget?draft=1");
	await expect(page.getByTestId("budget-card").getByRole("link", { name: /Budget in/ })).toHaveAttribute("href", "/budget");
});

test("calendar uses the user's currency", async ({ page }) => {
	await openHome(page, { txns: [tx("c", "Croma", thisMonth(4), 2210)], currency: "USD" });
	await expect(page.getByTestId("cal-day-4")).toContainText("$2.2k");
});

test("sidebar badge uses the count endpoint", async ({ page }) => {
	const counted = page.waitForRequest((r) => r.url().includes("/api/review") && r.url().includes("count=1"));
	await openHome(page, typical, 2);
	await counted;
	await expect(page.locator('[data-sidebar="menu-badge"]')).toHaveText("2");
});

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("home header keeps clear of the account menu", async ({ page }) => {
	for (const [width, height] of [[1440, 900], [1024, 800]]) {
		await page.setViewportSize({ width, height });
		await openHome(page);
		await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-size", "26px");
		const menu = (await page.getByRole("button", { name: "Account menu" }).boundingBox())!;
		for (const name of [/upload/i, /^export$/i]) {
			const box = (await page.getByRole("button", { name }).first().boundingBox())!;
			expect(overlaps(menu, box), `${String(name)} at ${width}px`).toBe(false);
		}
	}
});

test("hero shows an increase with its percent", async ({ page }) => {
	await openHome(page, { txns: [tx("a", "Croma", thisMonth(1), 30000), tx("b", "Rent", lastMonth(1), 20000)] });
	await expect(spend(page).getByTestId("spend-delta")).toHaveText(`+₹10,000 (50%) vs ${prevLong} by the ${ord(now.getDate())}`);
});

test("chart ticks never overlap at phone width", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await openHome(page);
	await expect(spend(page).getByTestId("tick").first()).toBeVisible();
	const boxes = await spend(page).getByTestId("tick").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
	expect(boxes.length).toBeGreaterThanOrEqual(2);
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `ticks ${i} and ${j}`).toBe(false);
});

test("the hero + opens upload", async ({ page }) => {
	await openHome(page);
	await spend(page).getByRole("button", { name: "Upload a receipt" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
});

test("calendar marks today and names future bills", async ({ page }) => {
	test.skip(now.getDate() === lastDay, "no future days left this month");
	const tomorrow = now.getDate() + 1;
	await openHome(page, {
		...typical,
		reminders: [{ id: "n", vendor: "Netflix", amount: 649, date: thisMonth(tomorrow), type: "upcoming" }],
	});
	await expect(page.getByTestId(`cal-day-${now.getDate()}`)).toHaveAttribute("data-today", "true");
	await expect(page.getByTestId(`cal-day-${tomorrow}`)).toHaveAttribute("data-future", "true");
	await expect(page.getByTestId(`cal-day-${tomorrow}`)).toContainText("Netflix");
	const card = page.getByTestId("calendar-card");
	await expect(card.getByRole("link", { name: new RegExp(`${monthLong}, day by day`) })).toHaveAttribute("href", "/spending");
	await expect(card.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/spending");
});

test("lumen found rows do things", async ({ page }) => {
	await openHome(page, { ...typical, summary: { found: [dupe, spike], worth_total: 2499 } });
	const rows = page.getByTestId("lumen-found").getByTestId("found-row");
	// the spike links to where you can act on it; a row with nowhere to go gets no dead link
	await expect(rows.nth(1).getByRole("link", { name: "See in Spending" })).toHaveAttribute("href", "/spending");
	await expect(rows.nth(0).getByRole("link", { name: /^Review|^See/ })).toHaveCount(0);
	// "Ask Lumen" opens Ask with the question typed, never sent
	const ask = rows.nth(1).getByRole("link", { name: "Ask Lumen" });
	await expect(ask).toHaveAttribute("href", /^\/ask\?draft=/);
	expect(decodeURIComponent((await ask.getAttribute("href"))!.split("draft=")[1])).toBe("Tell me more about this: Food is up 35%");
});

test("budget card shows the top four categories by spend", async ({ page }) => {
	const c = (category: string, limit: number, spent: number) => ({ category, limit, spent });
	await openHome(page, {
		...typical,
		budget: { monthly_budget: 100000, spent: 62182, categories: [c("Travel", 5000, 2140), c("Rent", 25000, 25000), c("Shopping", 8000, 16840), c("Groceries", 12000, 8120), c("Food", 6000, 5930), c("Health", 3000, 640)] },
	});
	const rows = page.getByTestId("budget-cat");
	await expect(rows).toHaveCount(4);
	expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-category")))).toEqual(["Rent", "Shopping", "Groceries", "Food"]);
	await expect(rows.nth(1)).toHaveAttribute("data-over", "true");
	await expect(rows.nth(0)).not.toHaveAttribute("data-over", "true");
});

test("an empty account keeps every card at its loading height", async ({ page }) => {
	await openHome(page, { txns: [], delayMs: 1500 });
	const cards = page.locator('[data-testid="home-main"] > section, [data-testid="home-side"] > section, [data-testid="spend-card"]');
	await expect(cards.first()).toBeVisible();
	const loading = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
	await expect(page.getByTestId("brief")).toBeVisible({ timeout: 15_000 });
	await page.waitForTimeout(300);
	const ready = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
	expect(ready.length).toBe(loading.length);
	ready.forEach((h, i) => expect(Math.abs(h - loading[i]), `card ${i}`).toBeLessThanOrEqual(1));
	await expect(page.locator("main")).not.toContainText(/NaN|of ₹0/);
});

test("calendar amounts stay readable at phone width", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await openHome(page, { ...typical, txns: [tx("big", "Rent", thisMonth(1), 25640), tx("b", "Rent", lastMonth(1), 20280)] });
	const amount = page.getByTestId("cal-day-1").locator("b");
	await expect(amount).toBeVisible();
	expect(await amount.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test("a restock reminder (no vendor) neither crashes Home nor shows as a bill", async ({ page }) => {
	await openHome(page, {
		...typical,
		reminders: [
			{ id: "g", vendor: "", category: "Groceries", amount: 900, date: inDays(1), type: "upcoming" },
			{ id: "n", vendor: "Netflix", amount: 649, date: inDays(2), type: "upcoming" },
		],
	});
	await expect(page.getByTestId("bill-row")).toHaveCount(1);
	await expect(page.getByTestId("bill-row")).toContainText("Netflix");
	await expect(page.getByTestId("calendar-card")).toBeVisible();
});

// relative luminance of an element's background; the theme uses oklch(), so let a canvas turn it into sRGB first
const bgLuminance = (el: import("@playwright/test").Locator) =>
	el.evaluate((e) => {
		const ctx = document.createElement("canvas").getContext("2d")!;
		ctx.fillStyle = getComputedStyle(e).backgroundColor;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
			const x = v / 255;
			return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	});

test("Home's actions are quiet, not loud blue", async ({ page }) => {
	await openHome(page);
	const upload = page.getByRole("button", { name: "Upload", exact: true });
	await expect(upload).toBeVisible();
	expect(await upload.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgb(37, 99, 235)");
	const exp = page.getByRole("button", { name: "Export", exact: true });
	await expect(exp).toBeVisible();
	await expect(exp).toHaveText("");
});

test("upload and export dialogs are light", async ({ page }) => {
	await openHome(page);
	for (const name of ["Upload", "Export"]) {
		await page.getByRole("button", { name, exact: true }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		expect(await bgLuminance(dialog), `${name} dialog`).toBeGreaterThan(0.85);
		expect(await dialog.evaluate((e) => e.outerHTML.match(/neutral-[89]00|#0b0612|text-white/g))).toBeNull();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	}
});

test("the upload dialog has one close button", async ({ page }) => {
	await openHome(page);
	await page.getByRole("button", { name: "Upload", exact: true }).click();
	await expect(page.getByRole("dialog").locator("button:has(svg.lucide-x)")).toHaveCount(1);
});

// Review fix: labels are anchored at the edges, so "Today" near the start or end of the axis used to collide.
for (const [day, range] of [["2026-10-26", "1M"], ["2026-10-04", "1M"], ["2026-10-29", "1M"], ["2026-10-27", "1W"], ["2026-10-26", "3M"]] as const) {
	test(`ticks don't overlap on ${day} (${range}) at phone width`, async ({ page }) => {
		await page.clock.setFixedTime(new Date(`${day}T12:00:00`));
		await page.setViewportSize({ width: 375, height: 812 });
		const [y, m] = day.split("-").map(Number);
		const at = (mm: number, dd: number) => `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
		await openHome(page, { txns: [tx("a", "Swiggy", at(m, 1), 18412), tx("t", "Uber", day, 300), tx("b", "Rent", at(m - 1, 1), 20280), tx("c", "Rent", at(m - 3, 1), 20280)] });
		if (range !== "1M") await spend(page).getByRole("button", { name: range }).click();
		await expect(spend(page).getByTestId("tick").first()).toBeVisible();
		await page.waitForTimeout(300);
		const boxes = await spend(page).getByTestId("tick").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
		for (let i = 0; i < boxes.length; i++)
			for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `ticks ${i} and ${j}`).toBe(false);
		if (range === "3M") {
			// every label names its month, so "14" can't mean any month
			const labels = await spend(page).getByTestId("tick").allTextContents();
			for (const l of labels) expect(l, l).toMatch(/Today|[A-Z][a-z]{2}/);
		}
	});
}

test("home's bills come from the recurring charges, active ones only", async ({ page }) => {
	const item = (vendor: string, days: number, extra: object = {}) => ({
		vendor, category: "Entertainment", cadence: "monthly", typical_amount: 649, last_charge_date: inDays(days - 30),
		next_due_date: inDays(days), charges_count: 3, price_change: null, kind: "subscription", possibly_stopped: false, state: "active", ...extra,
	});
	await openHome(page, {
		...typical,
		recurring: [item("Netflix", 2), item("Spotify", 3, { state: "cancelled" }), item("Gym", 4, { possibly_stopped: true }), item("Rent", 45)],
	});
	await expect(page.getByTestId("bill-row")).toHaveCount(1);
	await expect(page.getByTestId("bill-row")).toContainText("Netflix");
});
