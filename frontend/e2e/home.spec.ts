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
