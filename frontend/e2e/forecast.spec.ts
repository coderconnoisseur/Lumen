import { test, expect, type Page } from "@playwright/test";
import { forecastFixture, signIn, type HomeFixture } from "./fixtures";

const now = new Date();
const monthName = (n: number) => new Date(now.getFullYear(), now.getMonth() + n, 1).toLocaleString("en-US", { month: "long" });
const money = (n: number) => `₹${Math.round(n).toLocaleString("en-US")}`;
const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

const base = { spent: 60000, perDay: 1000, budget: 70000, income: 85000 };
const fc = (o: Partial<Parameters<typeof forecastFixture>[0]> = {}) => forecastFixture({ ...base, ...o });
const total = fc().months[0].forecast; // 60000 + 1000 per day left

async function openForecast(page: Page, home: HomeFixture = { forecast: fc() }) {
	await signIn(page, { home });
	await page.goto("/forecast");
}

test("the sidebar's Plan group opens Forecast", async ({ page }) => {
	await signIn(page, { home: { forecast: fc() } });
	await page.goto("/home");
	await page.getByRole("link", { name: "Forecast" }).click();
	await expect(page).toHaveURL(/\/forecast$/);
	await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
});

test("headline: where this month lands and how it sits against the budget", async ({ page }) => {
	await openForecast(page, { forecast: fc({ budget: 50000 }) });
	await expect(page.getByTestId("brief")).toHaveText(`${monthName(0)} lands near ${money(total)} · ${money(total - 50000)} over budget`);
	await expect(page.getByTestId("verdict")).toHaveAttribute("data-tone", "bad");
});

test("headline: under budget reads as good news; no budget, no verdict", async ({ page }) => {
	await openForecast(page, { forecast: fc({ budget: 200000 }) });
	await expect(page.getByTestId("verdict")).toHaveText(`${money(200000 - total)} under budget`);
	await expect(page.getByTestId("verdict")).toHaveAttribute("data-tone", "good");
	await openForecast(page, { forecast: fc({ budget: null }) });
	await expect(page.getByTestId("brief")).toHaveText(`${monthName(0)} lands near ${money(total)}`);
	await expect(page.getByTestId("verdict")).toHaveCount(0);
});

test("the accuracy pill says how far off the forecast usually is", async ({ page }) => {
	await openForecast(page);
	await expect(page.getByTestId("accuracy")).toHaveText("Usually off by about 13% · last 6 months");
	await openForecast(page, { forecast: fc({ accuracy: { months_tested: 2 } }) });
	await expect(page.getByTestId("accuracy")).toHaveText("Too little history to measure accuracy yet");
});

test("hero: the forecast, its range, the split and a pin per bill still due", async ({ page }) => {
	const bills = [{ day: 28, vendor: "City Power", amount: 2000 }, { day: 30, vendor: "Jio", amount: 399 }];
	await openForecast(page, { forecast: fc({ bills }) });
	const hero = page.getByTestId("forecast-hero");
	await expect(hero).toContainText(`${monthName(0)} lands at`);
	await expect(hero.getByTestId("hero-total")).toContainText(money(total));
	await expect(hero).toContainText(`likely ${money(total * 0.9)} – ${money(total * 1.1)} · spent ${money(60000)} so far`);
	await expect(hero.getByTestId("split")).toContainText("Spent so far");
	await expect(hero.getByTestId("split")).toContainText("Bills still due (0)");
	await expect(hero.getByTestId("split")).toContainText(`Everyday spending, ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
	await expect(hero.getByTestId("bill-pin")).toHaveCount(2);
});

test("four month cards: forecast, range, budget, money left and the why line", async ({ page }) => {
	await openForecast(page, { forecast: fc({ why: "Includes the yearly ₹1,500 CloudVault renewal." }) });
	const cards = page.getByTestId("forecast-month");
	await expect(cards).toHaveCount(4);
	await expect(cards.nth(0)).toContainText(monthName(0));
	await expect(cards.nth(0)).toContainText(money(total));
	await expect(cards.nth(0)).toContainText(`budget ${money(70000)}`);
	await expect(cards.nth(0)).toContainText(`Left of ${money(85000)} income`);
	await expect(cards.nth(0)).toContainText(money(85000 - total));
	await expect(cards.nth(3)).toContainText(monthName(3));
	await expect(cards.nth(3)).toContainText("Includes the yearly ₹1,500 CloudVault renewal.");
	await openForecast(page, { forecast: fc({ budget: null }) });
	await expect(page.getByTestId("forecast-month").nth(1)).toContainText("no budget yet");
});

test("without an income the cards offer to add one, saved to the profile", async ({ page }) => {
	await openForecast(page, { forecast: fc({ income: null }) });
	await expect(page.getByTestId("forecast-month").first()).not.toContainText("Left of");
	await page.getByRole("button", { name: "Add your income" }).first().click();
	await page.getByLabel("Monthly income").fill("90000");
	const put = page.waitForRequest((r) => r.url().endsWith("/api/profile") && r.method() === "PUT");
	await page.getByLabel("Monthly income").press("Enter");
	expect((await put).postDataJSON()).toEqual({ monthly_income: 90000 });
});

test("too little history: a plain message and a way to add more, no chart", async ({ page }) => {
	await openForecast(page, { forecast: null });
	await expect(page.getByTestId("forecast-empty")).toContainText("a month of spending");
	await expect(page.getByTestId("forecast-empty").getByRole("link")).toHaveAttribute("href", "/receipts/import");
	await expect(page.getByTestId("forecast-hero")).toHaveCount(0);
});

test("a failed load says so", async ({ page }) => {
	await openForecast(page, { forecast: "fail" });
	await expect(page.getByTestId("forecast-empty")).toContainText("Couldn't load the forecast");
});

test("the forecast request names the browser's date", async ({ page }) => {
	const urls: string[] = [];
	page.on("request", (r) => r.url().includes("/api/forecast") && urls.push(r.url()));
	await openForecast(page);
	await expect(page.getByTestId("forecast-hero")).toBeVisible();
	expect(urls.every((u) => u.includes(`today=${iso}`)) && urls.length > 0).toBe(true);
});

const cats = [
	{ category: "Shopping", spent: 18514, forecast: 19100, budget: 9000 },
	{ category: "Food", spent: 5095, forecast: 6000, budget: 6500 },
	{ category: "Transport", spent: 2937, forecast: 3800, budget: null },
];
const catRow = (page: Page, name: string) => page.getByTestId("forecast-category").filter({ hasText: name });

test("by category: spent, forecast, budget and where each lands", async ({ page }) => {
	await openForecast(page, { forecast: fc({ categories: cats }) });
	await expect(page.getByTestId("forecast-categories")).toContainText(`${monthName(0)} by category`);
	await expect(page.getByTestId("forecast-category")).toHaveCount(3);
	await expect(catRow(page, "Shopping")).toContainText(money(18514));
	await expect(catRow(page, "Shopping")).toContainText(money(19100));
	await expect(catRow(page, "Shopping")).toContainText("₹10,100 over");
	await expect(catRow(page, "Food")).toContainText("₹500 left");
	await expect(catRow(page, "Transport")).toContainText("no budget");
	await expect(page.getByTestId("over-count")).toHaveText("1 will run over");
});

const items = [{ vendor: "StreamFlix", kind: "subscription", monthly_equivalent: 766 }, { vendor: "FitZone Gym", kind: "bill", monthly_equivalent: 1500 }];

test("what if: cancelling a bill moves the next three months' money left, nothing is saved", async ({ page }) => {
	await openForecast(page, { forecast: fc({ items }) });
	const box = page.getByTestId("what-if");
	await expect(box).toContainText("Turn one on");
	const writes: string[] = [];
	page.on("request", (r) => r.method() !== "GET" && writes.push(r.url()));
	await box.getByRole("switch", { name: "Cancel StreamFlix" }).click();
	const left = 85000 - 30000; // the fixture's next months: 1,000 a day × 30
	await expect(box.getByTestId("effect")).toHaveCount(3);
	await expect(box.getByTestId("effect").first()).toContainText(`${monthName(1)}: left ${money(left + 766)}`);
	await expect(box.getByTestId("effect").first()).toContainText(`was ${money(left)}`);
	await expect(box.getByRole("link", { name: "Cancel on Bills" })).toHaveAttribute("href", "/bills");
	await box.getByRole("switch", { name: "Cancel StreamFlix" }).click();
	await expect(box).toContainText("Turn one on");
	expect(writes).toEqual([]);
});

test("what if: an added monthly cost lowers what's left; without income it moves the forecast", async ({ page }) => {
	await openForecast(page, { forecast: fc({ items, income: null }) });
	const box = page.getByTestId("what-if");
	await box.getByLabel("Monthly cost", { exact: true }).fill("5000");
	await box.getByRole("switch", { name: "Add a monthly cost" }).click();
	await expect(box.getByTestId("effect").first()).toContainText(`${monthName(1)}: ${money(30000 + 5000)}`);
	await expect(box.getByRole("link", { name: "Set a limit on Budget" })).toHaveAttribute("href", "/budget");
});

test("how this works: both methods' backtest error, the kept one marked", async ({ page }) => {
	await openForecast(page);
	const how = page.getByTestId("how-it-works");
	await expect(how.getByTestId("method")).toHaveCount(2);
	await expect(how.getByTestId("method").first()).toContainText("Bills + everyday");
	await expect(how.getByTestId("method").first()).toContainText("13%");
	await expect(how.getByTestId("method").first()).toContainText("kept");
	await expect(how.getByTestId("method").nth(1)).toContainText("tried");
	await openForecast(page, { forecast: fc({ accuracy: { months_tested: 2 } }) });
	await expect(page.getByTestId("how-it-works")).toContainText("too little history");
	await expect(page.getByTestId("how-it-works").getByTestId("method")).toHaveCount(0);
});

const full = () =>
	fc({
		categories: cats,
		items,
		bills: [{ day: 28, vendor: "City Power", amount: 2000 }],
		why: "Higher than usual: the ₹18,514 TechHub order on 17 Oct, and the yearly CloudVault renewal.",
	});
async function cls(page: Page) {
	await page.addInitScript(() => {
		(window as unknown as { cls: number }).cls = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
				if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
		}).observe({ type: "layout-shift", buffered: true });
	});
	await openForecast(page, { forecast: full(), forecastDelayMs: 1500 });
	await expect(page.getByTestId("forecast-month")).toHaveCount(4);
	await page.waitForTimeout(500);
	return page.evaluate(() => (window as unknown as { cls: number }).cls);
}

test("forecast has no layout shift while loading", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	expect(await cls(page)).toBeLessThan(0.01);
});

test("forecast has no layout shift while loading on a phone", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	expect(await cls(page)).toBeLessThan(0.01);
});

test("forecast fits a phone without sideways scroll", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await openForecast(page, { forecast: full() });
	await expect(page.getByTestId("forecast-month")).toHaveCount(4);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	const ends = await page
		.locator('header *, [data-testid="forecast-month"], [data-testid="forecast-category"] > *, [data-testid="what-if"] button, [data-testid="what-if"] input, [data-testid="method"]')
		.evaluateAll((els) => els.map((e) => [e.getAttribute("aria-label") ?? e.textContent, e.getBoundingClientRect().right] as const));
	for (const [what, right] of ends) expect(right, String(what)).toBeLessThanOrEqual(375);
});

test("every button, switch and field on the forecast has a name", async ({ page }) => {
	await openForecast(page, { forecast: fc({ ...{ categories: cats, items }, income: null }) });
	await expect(page.getByTestId("forecast-month")).toHaveCount(4);
	const unnamed = await page.locator("main button, main input, main [role=switch]").evaluateAll((els) =>
		els.filter((e) => !(e.getAttribute("aria-label") || e.textContent?.trim())).map((e) => e.outerHTML.slice(0, 80)),
	);
	expect(unnamed).toEqual([]);
});
