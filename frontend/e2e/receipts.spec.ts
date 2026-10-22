import { test, expect, type Page } from "@playwright/test";
import { signIn, type HomeFixture } from "./fixtures";

const flagged = (id: string, invoice: Record<string, unknown>, rules: string[]) => ({
	id, status: "flagged", confidence: "low", invoice, transaction_id: null, note: null, created_at: "2026-10-12T10:00:00",
	flags: rules.map((rule) => ({ rule, severity: "fail", detail: `detail for ${rule}` })),
});
const sample: HomeFixture = {
	review: [
		flagged("r1", { vendor_name: "Croma", date: "2026-10-12", total_amount: 9999, invoice_number: "CR-2210" }, ["total_mismatch"]),
		flagged("r2", { vendor_name: "FreshMart", date: "2026-10-18", total_amount: 1284, invoice_number: "FM-55120", source: "email" }, ["duplicate"]),
	],
	txns: [
		{ id: "t1", vendor_name: "Jio Fiber", date: "2026-10-09", total_amount: 999, category: "Bills", created_at: null, source: "email", invoice_number: "JIO-1" },
		{ id: "t2", vendor_name: "Uber", date: "2026-10-08", total_amount: 212, category: "Transport", created_at: null, source: null, invoice_number: "U-9" },
		{ id: "t3", vendor_name: "Swiggy", date: "2026-10-07", total_amount: 450, category: "Food", created_at: null, source: "statement" },
	],
	documents: [{ id: "d1", title: "Rental agreement", doc_type: "contract", filename: "rent.pdf", chunk_count: 14, created_at: "2026-10-01T09:00:00" }],
	imports: [
		{ id: "i1", file_name: "hdfc-sep.csv", label: "HDFC Savings ··4417", period_from: "2026-09-01", period_to: "2026-09-30", lines: 142,
			imported: 97, matched: 21, duplicates: 3, credits: 21, unreadable: 0, created_at: "2026-10-03T08:00:00" },
	],
	email: { configured: true, email_address: "me@gmail.com", provider: "gmail", polling_enabled: true, transactions_added: 11,
		last_successful_poll: new Date(Date.now() - 12 * 60_000).toISOString() },
};
async function openReceipts(page: Page, home: HomeFixture = sample) {
	await signIn(page, { home });
	await page.goto("/receipts");
	await expect(page.getByTestId("library")).toContainText("Rental agreement", { timeout: 15_000 });
}
const card = (page: Page, vendor: string) => page.getByTestId("review-card").filter({ hasText: vendor });

test("receipts: heading and a brief from the queue", async ({ page }) => {
	await openReceipts(page);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Receipts & statements");
	await expect(page.getByTestId("brief")).toContainText("2 receipts need your OK before they count.");
});

test("review cards highlight the doubtful field and say why", async ({ page }) => {
	await openReceipts(page);
	await expect(page.getByTestId("review-card")).toHaveCount(2);
	await expect(card(page, "Croma").locator("[data-doubtful]")).toHaveText(["Total"]);
	await expect(card(page, "Croma")).toContainText("Totals don't add up.");
	await expect(card(page, "FreshMart").locator("[data-doubtful]")).toHaveText(["Bill no."]);
	await expect(card(page, "FreshMart")).toContainText("Looks like a duplicate.");
	await expect(card(page, "FreshMart")).toContainText("from email");
	await expect(card(page, "FreshMart").getByRole("button", { name: "Keep both" })).toBeVisible();
	await expect(card(page, "FreshMart").getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});

test("edit then approve sends only the changed fields", async ({ page }) => {
	const bodies: unknown[] = [];
	page.on("request", (r) => r.url().endsWith("/api/review/r1/approve") && bodies.push(r.postDataJSON()));
	await openReceipts(page);
	await card(page, "Croma").getByRole("button", { name: "Edit" }).click();
	await card(page, "Croma").getByRole("textbox", { name: "Total" }).fill("9990");
	await card(page, "Croma").getByRole("button", { name: "Save & approve" }).click();
	await expect(card(page, "Croma")).toHaveCount(0);
	expect(bodies).toEqual([{ edits: { total_amount: 9990 } }]);
});

test("reject removes the card and the sidebar badge drops", async ({ page }) => {
	await openReceipts(page);
	await expect(page.locator('[data-sidebar="menu-badge"]')).toHaveText("2");
	await card(page, "FreshMart").getByRole("button", { name: "Reject" }).click();
	await expect(card(page, "FreshMart")).toHaveCount(0);
	await expect(page.locator('[data-sidebar="menu-badge"]')).toHaveText("1");
});

test("no queue, no review section", async ({ page }) => {
	await openReceipts(page, { ...sample, review: [] });
	await expect(page.getByTestId("review")).toHaveCount(0);
	await expect(page.getByTestId("brief")).toContainText("Everything you've given Lumen is filed.");
});

test("library: receipts, review items, documents and statements in one list", async ({ page }) => {
	await openReceipts(page);
	const rows = page.getByTestId("library-row");
	await expect(rows).toHaveCount(6); // 2 receipts (not the statement line), 2 in review, 1 document, 1 import
	await expect(rows.filter({ hasText: "Jio Fiber" })).toContainText("Gmail");
	await expect(rows.filter({ hasText: "Croma" })).toContainText("Needs review");
	await page.getByRole("button", { name: "Statements", exact: true }).click();
	await expect(rows).toHaveCount(1);
	await expect(rows).toContainText("HDFC Savings ··4417");
	await expect(rows).toContainText("Import");
	await page.getByRole("button", { name: "All", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search" }).fill("uber");
	await expect(rows).toHaveCount(1);
});

test("deleting a document from the library", async ({ page }) => {
	await openReceipts(page);
	await page.getByRole("button", { name: "Delete Rental agreement" }).click();
	await expect(page.getByTestId("library-row").filter({ hasText: "Rental agreement" })).toHaveCount(0);
});

test("statement imports card shows counts", async ({ page }) => {
	await openReceipts(page);
	const imports = page.getByTestId("imports");
	await expect(imports).toContainText("HDFC Savings ··4417");
	await expect(imports).toContainText("142 lines");
	for (const text of ["97 new", "21 matched", "3 duplicates", "21 credits skipped"]) await expect(imports).toContainText(text);
});

test("inbox: connected shows the address and checks now", async ({ page }) => {
	const polled = page.waitForRequest((r) => r.url().endsWith("/api/v1/email-config/poll-now") && r.method() === "POST");
	await openReceipts(page);
	const inbox = page.getByTestId("inbox");
	await expect(inbox).toContainText("me@gmail.com");
	await expect(inbox).toContainText("11 receipts added");
	await inbox.getByRole("button", { name: "Check now" }).click();
	await polled;
	await expect(inbox.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("inbox: not connected offers Gmail", async ({ page }) => {
	await openReceipts(page, { ...sample, email: { configured: false } });
	await expect(page.getByTestId("inbox").getByRole("button", { name: /Connect with Google/ })).toBeVisible();
});

test("upload dialog can file a document", async ({ page }) => {
	const posted = page.waitForRequest((r) => r.url().endsWith("/api/documents") && r.method() === "POST");
	await openReceipts(page);
	await page.getByRole("button", { name: "Upload" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("radio", { name: "Documents" }).click();
	await dialog.locator('input[type="file"]').setInputFiles({ name: "policy.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
	await dialog.getByRole("button", { name: "Upload", exact: true }).click();
	const body = (await posted).postDataBuffer()!.toString();
	expect(body).toContain("policy.pdf");
	expect(body).toContain('name="doc_type"');
	await expect(dialog).toContainText("Statements are CSV files");
});

test("import statement goes to the import flow", async ({ page }) => {
	await openReceipts(page);
	await page.getByRole("link", { name: "Import statement" }).first().click();
	await expect(page).toHaveURL(/\/receipts\/import$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Import a statement");
});

test("old routes land on the new page", async ({ page }) => {
	await signIn(page, { home: sample });
	await page.goto("/review");
	await expect(page).toHaveURL(/\/receipts$/);
	await page.goto("/import");
	await expect(page).toHaveURL(/\/receipts\/import$/);
});

test("receipts has no layout shift while loading", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		(window as unknown as { cls: number }).cls = 0;
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
				if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
		}).observe({ type: "layout-shift", buffered: true });
	});
	await signIn(page, { home: { ...sample, delayMs: 1500 } });
	await page.goto("/receipts");
	await expect(page.getByTestId("library")).toContainText("Rental agreement", { timeout: 15_000 });
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.01);
});

test("receipts fits a phone", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await openReceipts(page);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	const ends = await page
		.locator('header a, header button, [data-testid="review-card"], [data-testid="library-row"] > *')
		.evaluateAll((els) => els.map((e) => [e.getAttribute("aria-label") ?? e.textContent, e.getBoundingClientRect().right] as const));
	for (const [what, right] of ends) expect(right, String(what)).toBeLessThanOrEqual(375);
});

test("a big statement import doesn't push the receipts out of the library", async ({ page }) => {
	const lines = Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, vendor_name: `Line ${i}`, date: "2026-10-20", total_amount: 10, category: null, created_at: null, source: "statement" }));
	await openReceipts(page, { ...sample, txns: [...lines, ...sample.txns!] });
	await expect(page.getByTestId("library-row").filter({ hasText: "Jio Fiber" })).toHaveCount(1);
});

test("a review card and a document open their original", async ({ page }) => {
	const opened: string[] = [];
	page.on("request", (r) => r.url().includes("/api/files/") && opened.push(r.url().split("/api/files/")[1]));
	const review = [flagged("r1", { vendor_name: "Croma", total_amount: 9999, file_key: "inv/croma.png" }, ["total_mismatch"])];
	await openReceipts(page, { ...sample, review, documents: [{ ...sample.documents![0], file_key: "doc/rent.pdf" }] });
	await card(page, "Croma").getByRole("button", { name: "Open original" }).click();
	await page.getByRole("button", { name: "Open Rental agreement" }).click();
	await expect.poll(() => opened).toEqual(["inv/croma.png", "doc/rent.pdf"]);
});

test("a decision the server refuses says why", async ({ page }) => {
	await openReceipts(page, { ...sample, replaced: ["r1"] });
	await card(page, "Croma").getByRole("button", { name: "Approve", exact: true }).click();
	await expect(page.getByText("This invoice is already recorded")).toBeVisible();
	await expect(card(page, "Croma")).toHaveCount(1);
});

test("an edit can't approve an empty or non-numeric total", async ({ page }) => {
	await openReceipts(page);
	await card(page, "Croma").getByRole("button", { name: "Edit" }).click();
	const total = card(page, "Croma").getByRole("textbox", { name: "Total" });
	const save = card(page, "Croma").getByRole("button", { name: "Save & approve" });
	await total.fill("");
	await expect(save).toBeDisabled();
	await total.fill("1,234");
	await expect(save).toBeDisabled();
	await total.fill("1234.5");
	await expect(save).toBeEnabled();
});

