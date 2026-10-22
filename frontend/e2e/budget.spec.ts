import { test, expect, type Page } from "@playwright/test";
import { signIn, type HomeFixture } from "./fixtures";

const now = new Date();
const ym = (n: number) => {
	const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthName = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, 1).toLocaleString("en-US", { month: "long" });
const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
const c = (category: string, limit: number, spent: number) => ({ category, limit, spent });
const line = (id: string, target: string, limit: number) => ({
	id, type: "set_budget", target, risk: "low", reason: "Averaged a month over Jul–Sep, rounded up.",
	payload: { limit, basis: { months: [], average: limit } }, status: "pending", created_at: null,
});
const sample: HomeFixture = {
	budget: { monthly_budget: 100000, spent: 62182, categories: [c("Shopping", 8000, 16840), c("Food", 6000, 5930), c("Travel", 5000, 2140)] },
	history: [
		{ month: ym(3), budget: null, spent: 70000 },
		{ month: ym(2), budget: 100000, spent: 104200 },
		{ month: ym(1), budget: 100000, spent: 79900 },
		{ month: ym(0), budget: 100000, spent: 62182 },
	],
};
async function openBudget(page: Page, home: HomeFixture = sample, path = "/budget") {
	await signIn(page, { home });
	await page.goto(path);
	await expect(page.getByTestId("budget-hero")).toContainText("₹", { timeout: 15_000 });
}
const row = (page: Page, name: string) => page.getByTestId("budget-row").filter({ hasText: name });

test("budget: heading, spent of total, left, days left and safe per day", async ({ page }) => {
	await openBudget(page);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Budget");
	const hero = page.getByTestId("budget-hero");
	await expect(hero).toContainText("₹62,182");
	await expect(hero).toContainText("of ₹100,000");
	await expect(hero.getByTestId("left")).toContainText("₹37,818");
	await expect(hero.getByTestId("days-left")).toContainText(String(daysLeft));
	await expect(hero.getByTestId("per-day")).toContainText(`₹${Math.round(37818 / daysLeft).toLocaleString("en-US")}`);
	await expect(hero.getByTestId("even-pace")).toBeVisible();
});

test("the sidebar has a Plan group with Budget", async ({ page }) => {
	await openBudget(page);
	const link = page.locator('[data-sidebar="menu-button"]', { hasText: "Budget" });
	await expect(link).toHaveAttribute("href", "/budget");
	await expect(link).toHaveAttribute("data-active", "true");
	await expect(page.getByText("Plan", { exact: true })).toBeVisible();
});

test("by category: tones, unassigned footer", async ({ page }) => {
	await openBudget(page);
	await expect(row(page, "Shopping")).toHaveAttribute("data-tone", "bad");
	await expect(row(page, "Food")).toHaveAttribute("data-tone", "warn");
	await expect(row(page, "Travel")).toHaveAttribute("data-tone", "good");
	await expect(row(page, "Shopping")).toContainText("₹8,840 over");
	await expect(page.getByTestId("budget-footer")).toContainText("Categories add up to ₹19,000");
	await expect(page.getByTestId("budget-footer")).toContainText("₹81,000 of your ₹100,000 is unassigned");
});

test("editing a category's budget in place: Enter saves, the row keeps its height", async ({ page }) => {
	const puts: unknown[] = [];
	page.on("request", (r) => r.method() === "PUT" && r.url().endsWith("/api/budget") && puts.push(r.postDataJSON()));
	await openBudget(page);
	const before = (await row(page, "Food").boundingBox())!;
	await row(page, "Food").getByRole("button", { name: "Edit Food budget" }).click();
	const input = row(page, "Food").getByRole("textbox", { name: "Food budget" });
	await expect(input).toBeFocused();
	expect((await row(page, "Food").boundingBox())!.height).toBe(before.height);
	await input.fill("9000");
	await input.press("Enter");
	await expect(row(page, "Food")).toContainText("₹9,000");
	expect(puts).toEqual([{ month: ym(0), categories: [{ category: "Food", limit: 9000 }] }]);
});

test("Esc cancels an edit without saving", async ({ page }) => {
	let puts = 0;
	page.on("request", (r) => r.method() === "PUT" && puts++);
	await openBudget(page);
	await row(page, "Food").getByRole("button", { name: "Edit Food budget" }).click();
	await row(page, "Food").getByRole("textbox").fill("1");
	await row(page, "Food").getByRole("textbox").press("Escape");
	await expect(row(page, "Food")).toContainText("₹6,000");
	expect(puts).toBe(0);
});

test("add a category", async ({ page }) => {
	await openBudget(page);
	await page.getByRole("button", { name: "Add category" }).click();
	await page.getByRole("textbox", { name: "New category", exact: true }).fill("Health");
	await page.getByRole("textbox", { name: "New category budget" }).fill("3000");
	await page.getByRole("textbox", { name: "New category budget" }).press("Enter");
	await expect(row(page, "Health")).toContainText("₹3,000");
});

test("edit budget changes the overall total", async ({ page }) => {
	await openBudget(page);
	await page.getByRole("button", { name: "Edit budget" }).click();
	const input = page.getByRole("textbox", { name: "Monthly budget" });
	await expect(input).toBeFocused();
	await input.fill("120000");
	await input.press("Enter");
	await expect(page.getByTestId("budget-hero")).toContainText("of ₹120,000");
});

test("a past month is read-only and loads that month", async ({ page }) => {
	const asked = page.waitForRequest((r) => r.url().includes(`/api/budget?month=${ym(1)}`));
	await openBudget(page, { ...sample, budgetMonths: { [ym(1)]: { monthly_budget: 100000, spent: 79900, categories: [c("Food", 5000, 4100)] } } });
	await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
	await page.getByRole("button", { name: "Previous month" }).click();
	await asked;
	await expect(page.getByTestId("month-label")).toContainText(monthName(1));
	await expect(page.getByTestId("budget-hero")).toContainText("₹79,900");
	await expect(page.getByRole("button", { name: "Let Lumen draft" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Edit Food budget" })).toHaveCount(0);
	await expect(page.getByTestId("even-pace")).toHaveCount(0);
});

test("draft panel: pending lines with named buttons, skip one, approve the rest", async ({ page }) => {
	const approved: string[] = [];
	page.on("request", (r) => r.url().endsWith("/approve") && approved.push(r.url().split("/").at(-2)!));
	await openBudget(page, { ...sample, proposals: [line("p1", "Food", 6500), line("p2", "Travel", 4000), line("p3", "Health", 2000)] });
	const panel = page.getByTestId("draft-panel");
	await expect(panel.getByTestId("draft-line")).toHaveCount(3);
	await expect(panel.getByTestId("draft-line").filter({ hasText: "Food" })).toContainText("was ₹6,000");
	await expect(panel.getByTestId("draft-line").filter({ hasText: "Health" })).toContainText("new");
	await panel.getByRole("button", { name: "Skip Travel" }).click();
	await expect(panel.getByTestId("draft-line").filter({ hasText: "Travel" })).toContainText("Skipped");
	await panel.getByRole("button", { name: "Approve remaining 2" }).click();
	await expect(panel.getByText("Approved")).toHaveCount(2);
	expect(approved.sort()).toEqual(["p1", "p3"]);
	await expect(panel.getByRole("button", { name: "Approve Food at ₹6,500" })).toHaveCount(0);
});

test("let Lumen draft files a draft", async ({ page }) => {
	await openBudget(page, { ...sample, draft: [line("p1", "Food", 6500)] });
	await page.getByRole("button", { name: "Let Lumen draft" }).click();
	await expect(page.getByTestId("draft-panel").getByRole("button", { name: "Approve Food at ₹6,500" })).toBeVisible();
});

test("a draft with no history says why", async ({ page }) => {
	await openBudget(page, { ...sample, draft: [] });
	await page.getByRole("button", { name: "Let Lumen draft" }).click();
	await expect(page.getByTestId("draft-panel")).toContainText("Not enough history yet");
});

test("?draft=1 drafts on arrival (Home's promo links here)", async ({ page }) => {
	const drafted = page.waitForRequest((r) => r.url().endsWith("/api/budget/draft") && r.method() === "POST");
	await openBudget(page, { ...sample, draft: [line("p1", "Food", 6500)] }, "/budget?draft=1");
	await drafted;
	await expect(page.getByTestId("draft-line")).toHaveCount(1);
});

test("a replaced draft says so", async ({ page }) => {
	await openBudget(page, { ...sample, proposals: [line("p1", "Food", 6500)], replaced: ["p1"] });
	await page.getByRole("button", { name: "Approve Food at ₹6,500" }).click();
	await expect(page.getByTestId("draft-panel")).toContainText("This draft was replaced. Draft again.");
});

test("approve remaining ignores a double click", async ({ page }) => {
	let approvals = 0;
	page.on("request", (r) => r.url().endsWith("/approve") && approvals++);
	await openBudget(page, { ...sample, proposals: [line("p1", "Food", 6500), line("p2", "Travel", 4000)] });
	await page.getByRole("button", { name: "Approve remaining 2" }).dblclick();
	await expect(page.getByTestId("draft-panel").getByText("Approved")).toHaveCount(2);
	await page.waitForTimeout(300);
	expect(approvals).toBe(2);
});

test("last months: budget outline vs actual, over in red, track record", async ({ page }) => {
	await openBudget(page);
	const bars = page.getByTestId("history-month");
	await expect(bars).toHaveCount(4);
	await expect(bars.nth(1)).toHaveAttribute("data-over", "true");
	await expect(bars.nth(2)).not.toHaveAttribute("data-over", "true");
	await expect(bars.nth(0).getByTestId("history-budget")).toHaveCount(0); // no budget then
	await expect(page.getByTestId("track-record")).toContainText("1 of 2");
});

test("budget has no layout shift while loading", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		(window as unknown as { cls: number }).cls = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
				if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
		}).observe({ type: "layout-shift", buffered: true });
	});
	await openBudget(page, { ...sample, proposals: [line("p1", "Food", 6500)], delayMs: 1500 });
	await expect(page.getByTestId("draft-line")).toHaveCount(1);
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.01);
});

test("budget fits a phone without sideways scroll", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await openBudget(page, { ...sample, history: [5, 4, 3, 2, 1, 0].map((n) => ({ month: ym(n), budget: 100000, spent: 104200 })) });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	// the page clips rather than scrolls, so check nothing ends past the screen edge either
	const ends = await page
		.locator('header button, [data-testid="history-month"], [data-testid="budget-row"] > *')
		.evaluateAll((els) => els.map((e) => [e.getAttribute("aria-label") ?? e.textContent, e.getBoundingClientRect().right] as const));
	for (const [what, right] of ends) expect(right, String(what)).toBeLessThanOrEqual(375);
});

test("every budget request names the browser's month (the server's date can differ around midnight on the 1st)", async ({ page }) => {
	const urls: string[] = [];
	page.on("request", (r) => r.url().includes("/api/budget") && r.method() === "GET" && urls.push(r.url()));
	await openBudget(page);
	expect(urls.some((u) => u.includes(`/api/budget?month=${ym(0)}`))).toBe(true);
	expect(urls.some((u) => u.includes(`/api/budget/history?months=6&to=${ym(0)}`))).toBe(true);
	expect(urls.filter((u) => /\/api\/budget$/.test(u))).toEqual([]);
});

