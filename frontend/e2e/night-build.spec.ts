import { test, expect } from "@playwright/test";
import { budgetHeroOverlaps, signIn } from "./fixtures";

// What only the real Night switch shows (icons, figures, first paint), as opposed to flipping the attribute. The theme
// cookie is what the account menu's "Dark mode" sets.
test.beforeEach(async ({ context, baseURL }) => {
	await context.addCookies([{ name: "app_theme", value: "night", url: baseURL! }]);
});

test("app pages are night from the first server paint", async ({ request }) => {
	const html = await (await request.get("/home", { headers: { cookie: "lumen_session=1; app_theme=night" } })).text();
	expect(html).toContain('data-app-theme="night"');
	expect(html).toContain('<meta name="theme-color" content="#0b0b0c"/>');
});

const n = new Date();
const home = {
	txns: [{ id: "a", vendor_name: "Swiggy", date: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`, total_amount: 18412, category: "Food", created_at: null }],
};

test("sidebar icons are Phosphor", async ({ page }) => {
	await signIn(page, { home });
	await page.goto("/home");
	await expect(page.getByRole("link", { name: "Spending" }).locator("svg")).toHaveAttribute("viewBox", "0 0 256 256");
});

test("hero figure uses NumberFlow", async ({ page }) => {
	await signIn(page, { home });
	await page.goto("/home");
	// NumberFlow gives screen readers this string through ElementInternals, so it isn't an attribute we can read
	await expect(page.getByTestId("spend-figure").locator("number-flow-react")).toHaveAttribute("data", /"valueAsString":"[^"]*18,412"/);
});

for (const [route, testId] of [["/home", "spend-card"], ["/spending", "spending-hero"]]) {
	test(`${route} hero keeps its height when the figure arrives`, async ({ page }) => {
		await signIn(page, { home: { ...home, delayMs: 1500 } });
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(route);
		const card = page.getByTestId(testId);
		await expect(card.locator('[data-slot="skeleton"]').first()).toBeVisible();
		const loading = (await card.boundingBox())!.height;
		await expect(card.locator("number-flow-react").first()).toBeAttached({ timeout: 15_000 });
		await page.waitForTimeout(300);
		expect((await card.boundingBox())!.height).toBeCloseTo(loading, 0);
	});
}

test("page heroes roll too", async ({ page }) => {
	const budget = { monthly_budget: 60000, spent: 18412, categories: [] };
	await signIn(page, { home: { ...home, budget } });
	await page.goto("/spending");
	await expect(page.getByTestId("spending-hero").locator("number-flow-react").first()).toBeAttached();
	await page.goto("/budget");
	await expect(page.getByTestId("budget-hero").locator("number-flow-react").first()).toBeAttached();
});

test("switching range rolls the figure without moving the card", async ({ page }) => {
	await signIn(page, { home });
	await page.goto("/home");
	const card = page.getByTestId("spend-card");
	await expect(card.getByTestId("spend-figure").locator("number-flow-react")).toBeAttached();
	const before = (await card.boundingBox())!.height;
	await card.getByRole("button", { name: "YTD" }).click();
	await expect(card.getByRole("link", { name: /Spent in \d{4}/ })).toBeVisible();
	expect((await card.boundingBox())!.height).toBeCloseTo(before, 0);
});

test("the budget hero holds a 12-digit amount on a phone with rolling digits", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await signIn(page, { home: { ...home, budget: { monthly_budget: 999_999_999_999, spent: 499_999_999_999, categories: [] } } });
	await page.goto("/budget");
	await expect(page.getByTestId("budget-hero").locator("number-flow-react").first()).toBeAttached();
	await page.waitForTimeout(1000); // let the digits finish rolling in
	expect(await budgetHeroOverlaps(page)).toEqual([]);
});

test("the account menu switches theme and remembers it", async ({ page, context, baseURL }) => {
	await context.clearCookies({ name: "app_theme" });
	await signIn(page, { home });
	await page.goto("/home");
	const shell = page.locator("[data-app-theme]").first();
	const spending = page.getByRole("link", { name: "Spending" }).locator("svg");
	await expect(shell).toHaveAttribute("data-app-theme", "sky");
	await expect(spending).toHaveAttribute("viewBox", "0 0 24 24");

	await page.getByRole("button", { name: "Account menu" }).first().click();
	await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
	await expect(shell).toHaveAttribute("data-app-theme", "night");
	await page.keyboard.press("Escape"); // the open menu hides the rest of the page from the accessibility tree
	await expect(spending).toHaveAttribute("viewBox", "0 0 256 256");
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b0b0c");
	expect((await context.cookies(baseURL!)).find((c) => c.name === "app_theme")?.value).toBe("night");

	await page.reload();
	await expect(shell).toHaveAttribute("data-app-theme", "night");
	await page.getByRole("button", { name: "Account menu" }).first().click();
	await page.getByRole("menuitemcheckbox", { name: "Dark mode" }).click();
	await expect(shell).toHaveAttribute("data-app-theme", "sky");
});
