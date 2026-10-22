import { test, expect, type Page } from "@playwright/test";
import { signIn, type HomeFixture } from "./fixtures";

const now = new Date();
const inDays = (n: number) => {
	const x = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
	return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const item = (vendor: string, next: number, amount: number, kind: string, extra: object = {}) => ({
	vendor, category: kind === "bill" ? "Rent" : "Entertainment", cadence: "monthly", typical_amount: amount,
	last_charge_date: inDays(next - 30), next_due_date: inDays(next), charges_count: 3, price_change: null, kind,
	possibly_stopped: false, state: "active", ...extra,
});
const sample: HomeFixture = {
	recurring: [
		item("Rent", 2, 25000, "bill"),
		item("Netflix", 9, 649, "subscription", { price_change: { previous: 499, latest: 649, percent: 30.1 } }),
		item("Spotify", -50, 119, "subscription", { possibly_stopped: true }),
		{ ...item("Prime", 120, 1500, "subscription"), cadence: "yearly" },
	],
};
async function openBills(page: Page, home: HomeFixture = sample) {
	await signIn(page, { home });
	await page.goto("/bills");
}
const table = (page: Page) => page.getByTestId("recurring-table");

test("bills: one heading and the three tiles", async ({ page }) => {
	await openBills(page);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bills & subscriptions");
	await expect(page.getByTestId("tile-due")).toContainText("₹25,649");
	await expect(page.getByTestId("tile-due")).toContainText("2 bills");
	await expect(page.getByTestId("tile-monthly")).toContainText("₹25,774");
	await expect(page.getByTestId("tile-stopped")).toContainText("₹119");
	await expect(page.getByTestId("tile-stopped")).toContainText("Spotify");
});

test("the calendar shows each bill on its day, month after month, without moving", async ({ page }) => {
	await openBills(page);
	const rent = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
	const cal = page.getByTestId("bill-calendar");
	const before = (await cal.boundingBox())!;
	if (rent.getMonth() !== now.getMonth()) await page.getByRole("button", { name: "Next month" }).click();
	await expect(cal.getByTestId(`bill-day-${rent.getDate()}`)).toContainText("Rent");
	await page.getByRole("button", { name: "Next month" }).click();
	await expect(cal.getByTestId(`bill-day-${Math.min(rent.getDate(), 28)}`)).toBeVisible();
	await expect(cal).toContainText("Rent");
	const after = (await cal.boundingBox())!;
	expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test("upcoming groups the next 30 days", async ({ page }) => {
	await openBills(page);
	const up = page.getByTestId("upcoming");
	await expect(up).toContainText("Rent");
	await expect(up).toContainText("Netflix");
	await expect(up).not.toContainText("Spotify"); // looks stopped
});

test("tabs: subscriptions vs bills", async ({ page }) => {
	await openBills(page);
	await table(page).getByRole("tab", { name: /Subscriptions/ }).click();
	await expect(table(page).getByTestId("recurring-row")).toHaveCount(3);
	await expect(table(page)).not.toContainText("Rent");
	await table(page).getByRole("tab", { name: /^Bills/ }).click();
	await expect(table(page).getByTestId("recurring-row")).toHaveCount(1);
	await expect(table(page).getByTestId("recurring-row")).toContainText("Rent");
	await expect(table(page).getByRole("tab", { name: /Subscriptions/ })).toContainText("3");
});

test("mark as cancelled moves the row into Cancelled, and undo brings it back", async ({ page }) => {
	const posts: unknown[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().includes("/api/bills/recurring/state") && posts.push(r.postDataJSON()));
	await openBills(page);
	const netflix = table(page).getByTestId("recurring-row").filter({ hasText: "Netflix" });
	await expect(netflix).toContainText("₹499 → ₹649");
	await netflix.getByRole("button", { name: "Mark as cancelled" }).click();
	await expect(page.getByTestId("cancelled-group")).toContainText("Netflix");
	expect(posts).toEqual([{ vendor: "Netflix", state: "cancelled" }]);
	await page.getByTestId("cancelled-group").getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("cancelled-group")).toHaveCount(0);
	expect(posts.at(-1)).toEqual({ vendor: "Netflix", state: "active" });
});

test("not a bill hides it; hidden lists it with undo", async ({ page }) => {
	await openBills(page);
	await table(page).getByTestId("recurring-row").filter({ hasText: "Rent" }).getByRole("button", { name: "Not a bill" }).click();
	await expect(table(page).getByTestId("recurring-row").filter({ hasText: "Rent" })).toHaveCount(0);
	await page.getByRole("button", { name: "Hidden (1)" }).click();
	await expect(page.getByTestId("hidden-list")).toContainText("Rent");
	await page.getByTestId("hidden-list").getByRole("button", { name: "Undo" }).click();
	await expect(table(page).getByTestId("recurring-row").filter({ hasText: "Rent" })).toHaveCount(1);
});

test("how to cancel opens Ask with the question typed", async ({ page }) => {
	await openBills(page);
	const link = table(page).getByTestId("recurring-row").filter({ hasText: "Netflix" }).getByRole("link", { name: "How to cancel" });
	await expect(link).toHaveAttribute("href", "/ask?draft=How%20do%20I%20cancel%20Netflix%3F");
});

test("bills has no layout shift while loading", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		(window as unknown as { cls: number }).cls = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
				if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
		}).observe({ type: "layout-shift", buffered: true });
	});
	await openBills(page, { ...sample, delayMs: 1500 });
	await expect(page.getByTestId("brief")).toBeVisible({ timeout: 15_000 });
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.01);
});
