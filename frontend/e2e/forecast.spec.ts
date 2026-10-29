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
