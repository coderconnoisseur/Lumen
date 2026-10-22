import { test, expect, type Page } from "@playwright/test";
import { signIn, type HomeFixture } from "./fixtures";

// Dates relative to the real "today" so the period maths sees them in this / last month.
const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth();
const ymd = (y: number, m: number, d: number) => {
	const x = new Date(y, m, d);
	return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const thisMonth = (d: number) => ymd(Y, M, Math.min(d, now.getDate()));
const lastMonth = (d: number) => ymd(Y, M - 1, d);
const tx = (id: string, vendor_name: string, date: string, total_amount: number, category: string | null = "Food", source: string | null = null) => ({
	id, vendor_name, date, total_amount, category, created_at: null, source,
});

export const sample: HomeFixture = {
	txns: [
		tx("a", "Swiggy", thisMonth(1), 600, "Food"),
		tx("b", "Croma", thisMonth(1), 9999, "Shopping", "statement"),
		tx("c", "Amazon", thisMonth(1), 1499, "Shopping"),
		tx("d", "Mystery", thisMonth(1), 250, null),
		tx("e", "Swiggy", lastMonth(3), 400, "Food"),
		tx("f", "Rent", lastMonth(2), 25000, "Rent"),
	],
};

export async function openSpending(page: Page, home: HomeFixture = sample, url = "/spending") {
	await signIn(page, { home });
	await page.goto(url);
}
const hero = (page: Page) => page.getByTestId("spending-hero");

test("spending is one page with one heading", async ({ page }) => {
	await openSpending(page);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending");
	await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
	for (const old of ["Spending Analytics", "AI Analytics", "Spending Comparison"]) await expect(page.getByText(old, { exact: true })).toHaveCount(0);
});

test("period choices keep the hero's box", async ({ page }) => {
	await openSpending(page);
	await expect(hero(page)).toContainText("₹12,348");
	const before = (await hero(page).boundingBox())!;
	for (const name of ["Last month", "3M", "YTD", "This month"]) {
		await page.getByRole("button", { name, exact: true }).click();
		await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
		const box = (await hero(page).boundingBox())!;
		expect(Math.abs(box.height - before.height), name).toBeLessThanOrEqual(1);
		expect(Math.abs(box.y - before.y), name).toBeLessThanOrEqual(1);
	}
	await page.getByRole("button", { name: "Last month", exact: true }).click();
	await expect(hero(page)).toContainText("₹25,400");
});

test("custom period shows two date inputs", async ({ page }) => {
	await openSpending(page);
	await page.getByRole("button", { name: "Custom", exact: true }).click();
	await expect(page.getByLabel("From", { exact: true })).toHaveAttribute("type", "date");
	await expect(page.getByLabel("To", { exact: true })).toHaveAttribute("type", "date");
});

test("the brief uses real numbers", async ({ page }) => {
	await openSpending(page);
	await expect(page.getByTestId("brief")).toContainText("₹12,348");
});

test("hero: total, change, the running line and six months of bars", async ({ page }) => {
	await openSpending(page);
	await expect(hero(page)).toContainText("₹12,348");
	await expect(hero(page).locator('[data-series="current"]')).toHaveCount(1);
	await expect(hero(page).locator('[data-series="previous"]')).toHaveCount(1);
	const bars = hero(page).getByTestId("month-bar");
	await expect(bars).toHaveCount(6);
	await expect(bars.last()).toHaveAttribute("data-current", "true");
	// turning comparison off hides the previous line and the change
	await page.getByRole("switch").click();
	await expect(hero(page).locator('[data-series="previous"]')).toHaveCount(0);
	await expect(page.getByTestId("spending-delta")).toHaveCount(0);
});

test("3M and YTD show the months as the main chart", async ({ page }) => {
	await openSpending(page);
	await page.getByRole("button", { name: "3M", exact: true }).click();
	await expect(hero(page).getByTestId("month-bars-main")).toBeVisible();
	await expect(hero(page).locator('[data-series="current"]')).toHaveCount(0);
});

test("by category: bars, filter by click, clear", async ({ page }) => {
	await openSpending(page);
	const card = page.getByTestId("by-category");
	const rows = card.getByTestId("category-row");
	await expect(rows).toHaveCount(3);
	await expect(rows.first()).toContainText("Shopping");
	await expect(rows.first()).toContainText("₹11,498");
	await rows.first().click();
	await expect(page).toHaveURL(/category=Shopping/);
	await expect(card).toContainText("Filtering transactions: Shopping");
	await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
	await card.getByRole("button", { name: "Clear" }).click();
	await expect(page).not.toHaveURL(/category=/);
	await expect(card).toContainText("1 transaction still needs a category");
});

test("lumen noticed uses the same findings as Home", async ({ page }) => {
	const spike = { kind: "spike", tag: "SPENDING", subject: "Shopping", headline: "Shopping is up 35%", detail: "{0} so far.", amounts: [11498], worth: null, href: "/spending" };
	await openSpending(page, { ...sample, summary: { found: [spike] } });
	const card = page.getByTestId("lumen-found");
	await expect(card).toContainText("Lumen noticed");
	await expect(card.getByTestId("found-row")).toContainText("Shopping is up 35%");
	await expect(card.getByRole("link", { name: "Ask Lumen" })).toHaveAttribute("href", /^\/ask\?draft=/);
});
