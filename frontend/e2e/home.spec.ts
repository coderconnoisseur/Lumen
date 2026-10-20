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
const prevShort = new Date(Y, M - 1, 1).toLocaleString("en-GB", { month: "short" });
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
