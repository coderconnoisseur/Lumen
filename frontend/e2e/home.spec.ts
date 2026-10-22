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
const prevShort = new Date(Y, M - 1, 1).toLocaleString("en-US", { month: "short" });
const lastDay = new Date(Y, M + 1, 0).getDate();

test("spend card shows total and delta", async ({ page }) => {
	await openHome(page);
	await expect(spend(page).getByText("₹18,412", { exact: true })).toBeVisible();
	await expect(spend(page).getByTestId("spend-delta")).toHaveText(`↓ ₹1,868 vs ${prevShort} at this point`);
});

test("range chips switch period", async ({ page }) => {
	await openHome(page);
	await expect(spend(page)).toContainText("SPENT THIS MONTH", { ignoreCase: true });
	await spend(page).getByRole("button", { name: "1W" }).click();
	await expect(spend(page)).toContainText("SPENT THIS WEEK", { ignoreCase: true });
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
});

test("bill pins show upcoming bills", async ({ page }) => {
	test.skip(now.getDate() === lastDay, "no future days left this month");
	await openHome(page, {
		...typical,
		reminders: [{ id: "n", vendor: "Netflix", amount: 649, date: thisMonth(now.getDate() + 1), type: "upcoming" }],
	});
	await expect(spend(page).getByTestId("bill-pin")).toHaveText("Netflix");
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
	await expect(found.getByRole("link", { name: /review/i })).toHaveAttribute("href", "/receipts?tab=review");
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

test("bills card lists next three", async ({ page }) => {
	const r = (id: string, vendor: string, n: number) => ({ id, vendor, amount: 100, date: inDays(n), type: "upcoming" });
	await openHome(page, { ...typical, reminders: [r("4", "Rent", 9), r("1", "Netflix", 1), r("3", "Gym", 6), r("2", "Spotify", 3)] });
	const rows = page.getByTestId("bill-row");
	await expect(rows).toHaveCount(3);
	await expect(rows.first()).toContainText("Netflix");
});

test("budget card is honest with no budget", async ({ page }) => {
	await openHome(page);
	await expect(page.getByText("No budget yet")).toBeVisible();
	await expect(page.getByRole("button", { name: "DRAFT BUDGET" })).toBeEnabled();
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
	expect(titles.map((t) => t.split(" · ")[0])).toEqual(["budget", "upcoming bills", "let lumen draft your budget", "activity"]);
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
});

const dupe = { kind: "duplicate", tag: "DUPLICATES", headline: "Possible double charge: Croma {0}", detail: "Charged on 14 Oct and 15 Oct.",
	amounts: [2499], worth: 2499, href: null };
const spike = { kind: "spike", tag: "SPENDING", headline: "Food is up 35%", detail: "{0} so far vs {1} by this point last month.",
	amounts: [6750, 5000], worth: null, href: "/spending" };

test("lumen found shows server signals and worth", async ({ page }) => {
	await openHome(page, { ...typical, summary: { found: [dupe, spike], worth_total: 2499 } });
	const found = page.getByTestId("lumen-found");
	await expect(found).toContainText("2 things worth a look · ₹2,499 you may get back");
	await expect(found.getByTestId("found-tile")).toHaveCount(2);
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
	await expect(card).toContainText("₹9,588 left");
	await expect(card).toContainText("Food");
	await expect(page.getByText("Let Lumen draft your budget")).toHaveCount(0); // has category budgets already
});

test("budget card says when over", async ({ page }) => {
	await openHome(page, { ...typical, budget: { monthly_budget: 15000, spent: 18412, categories: [] } });
	await expect(page.getByTestId("budget-card")).toContainText("₹3,412 over");
});

const draftLine = (id: string, target: string, limit: number) => ({
	id, type: "set_budget", target, risk: "low", reason: "Averaged a month over Jul–Sep, rounded up.",
	payload: { limit, basis: { months: [], average: limit } }, status: "pending", created_at: null,
});

test("draft budget opens proposals and approve all applies them", async ({ page }) => {
	await openHome(page, { ...typical, draft: [draftLine("p1", "Food", 4000), draftLine("p2", "Travel", 1500)] });
	await page.getByRole("button", { name: "DRAFT BUDGET" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByTestId("draft-line")).toHaveCount(2);
	await expect(dialog).toContainText("₹4,000");
	const approvals = [page.waitForRequest(/proposals\/p1\/approve/), page.waitForRequest(/proposals\/p2\/approve/)];
	await dialog.getByRole("button", { name: "Approve all" }).click();
	await Promise.all(approvals);
	await expect(dialog.getByText("Approved")).toHaveCount(2);
	const refetch = page.waitForRequest((r) => r.url().endsWith("/api/budget") && r.method() === "GET");
	await page.keyboard.press("Escape");
	await refetch;
});

test("draft with no history explains why", async ({ page }) => {
	await openHome(page, { ...typical, draft: [] });
	await page.getByRole("button", { name: "DRAFT BUDGET" }).click();
	await expect(page.getByRole("dialog")).toContainText("Not enough history yet");
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

test("draft dialog ignores a double click", async ({ page }) => {
	await openHome(page, { ...typical, draft: [draftLine("p1", "Food", 4000), draftLine("p2", "Travel", 1500)] });
	let approvals = 0;
	page.on("request", (r) => r.url().includes("/proposals/") && r.url().endsWith("/approve") && approvals++);
	await page.getByRole("button", { name: "DRAFT BUDGET" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Approve all" }).dblclick();
	await expect(page.getByRole("dialog").getByText("Approved")).toHaveCount(2);
	await page.waitForTimeout(300);
	expect(approvals).toBe(2);
});

test("closing the draft dialog refreshes activity", async ({ page }) => {
	await openHome(page, { ...typical, draft: [draftLine("p1", "Food", 4000)] });
	await page.getByRole("button", { name: "DRAFT BUDGET" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Approve all" }).click();
	await expect(page.getByRole("dialog").getByText("Approved")).toHaveCount(1);
	const summary = page.waitForRequest((r) => r.url().endsWith("/api/home/summary"));
	await page.keyboard.press("Escape");
	await summary;
});

test("a replaced draft says so", async ({ page }) => {
	await openHome(page, { ...typical, draft: [draftLine("p1", "Food", 4000), draftLine("p2", "Travel", 1500)], replaced: ["p1"] });
	let approvals = 0;
	page.on("request", (r) => r.url().includes("/proposals/") && r.url().endsWith("/approve") && approvals++);
	await page.getByRole("button", { name: "DRAFT BUDGET" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Approve all" }).click();
	await expect(dialog).toContainText("This draft was replaced. Draft again.");
	await page.waitForTimeout(300);
	expect(approvals).toBe(1);
});
