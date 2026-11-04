import { test, expect } from "@playwright/test";
import { signIn } from "./fixtures";

// What only a real Night build can show. In PowerShell: $env:NEXT_PUBLIC_APP_THEME="night"; npx playwright test e2e/night-build.spec.ts
test.skip(process.env.NEXT_PUBLIC_APP_THEME !== "night", "needs NEXT_PUBLIC_APP_THEME=night");

test("app pages are night from the first server paint", async ({ request }) => {
	const html = await (await request.get("/home", { headers: { cookie: "lumen_session=1" } })).text();
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
	await expect(page.getByTestId("spend-figure").locator("number-flow-react")).toBeAttached();
	await expect(page.getByTestId("spend-figure").getByRole("img", { name: /18,412/ })).toBeVisible();
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
