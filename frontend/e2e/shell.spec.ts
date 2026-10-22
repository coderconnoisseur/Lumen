import { test, expect } from "@playwright/test";
import { signIn } from "./fixtures";

test("signed-in shell renders", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await signIn(page);
	await page.goto("/dashboard");
	await expect(page.locator('[data-slot="sidebar"]').first()).toBeVisible();
	await expect(page.getByText("Redirecting to sign in")).toHaveCount(0);
	expect(errors).toEqual([]);
});

const moved: [string, string][] = [
	["/dashboard", "/home"],
	["/analytics?tab=weekly", "/spending?tab=weekly"],
	["/ai-analytics", "/spending"],
	["/chatbot", "/ask"],
	["/documents", "/receipts"],
	["/import", "/receipts?tab=import"],
	["/review", "/receipts?tab=review"],
	["/upload", "/home?upload=1"],
];

test("old URLs redirect", async ({ request }) => {
	for (const [from, to] of moved) {
		const r = await request.get(from, { maxRedirects: 0 });
		expect([307, 308], from).toContain(r.status());
		expect(r.headers()["location"], from).toBe(to);
	}
});

test("new URLs require a session", async ({ request }) => {
	for (const p of ["/home", "/spending", "/bills", "/receipts", "/ask", "/settings"]) {
		const r = await request.get(p, { maxRedirects: 0 });
		expect(r.headers()["location"] ?? "", p).toContain("/login?reason=unauthorized");
	}
});

test("new pages render for a signed-in user", async ({ page }) => {
	await signIn(page);
	const pages: [string, string][] = [
		["/home", "Home"],
		["/spending", "Spending"],
		["/bills", "Bills & subscriptions"],
		["/receipts", "Receipts & statements"],
		["/receipts?tab=review", "Receipts & statements"],
		["/ask", "Ask Lumen"],
	];
	for (const [p, title] of pages) {
		await page.goto(p);
		await expect(page, p).toHaveTitle(new RegExp(`^${title}`));
	}
});

const sidebar = (page: import("@playwright/test").Page) => page.locator('[data-slot="sidebar-container"]');
const railWidth = (page: import("@playwright/test").Page) =>
	page.locator('[data-slot="sidebar-gap"]').evaluate((e) => e.getBoundingClientRect().width);

test("sidebar shows the new IA", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	const links = sidebar(page).locator('[data-sidebar="menu-button"]');
	await expect(links).toHaveText(["Home", "Spending", "Bills & subscriptions", "Budget", "Receipts & statements", "Ask Lumen", /^Ask anything/]);
	// every group is labelled (owner, 2026-10-22)
	for (const group of ["Overview", "Track", "Plan", "Records", "Assistant"]) {
		await expect(sidebar(page).getByText(group, { exact: true })).toBeVisible();
	}
	for (const old of ["Workspace", "Compare", "Financial command center"]) {
		await expect(page.getByText(old, { exact: true })).toHaveCount(0);
	}
});

test("review badge counts flagged receipts", async ({ page }) => {
	await signIn(page, { reviewCount: 3 });
	await page.goto("/home");
	await expect(sidebar(page).locator('[data-sidebar="menu-badge"]')).toHaveText("3");
});

test("ctrl+b collapses to a 56px rail with tooltips", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	await expect(sidebar(page)).toBeVisible();
	await page.keyboard.press("Control+b");
	await expect.poll(() => railWidth(page)).toBeCloseTo(56, 0);
	await expect(sidebar(page).getByText("Spending", { exact: true })).toBeHidden();
	await sidebar(page).locator('a[href="/spending"]').hover();
	await expect(page.getByRole("tooltip")).toHaveText("Spending");
});

test("the collapse control sits in the sidebar header, with no top bar on desktop", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	const toggle = sidebar(page).getByRole("button", { name: "Toggle sidebar (Ctrl+B)" });
	await toggle.click();
	await expect.poll(() => railWidth(page)).toBeCloseTo(56, 0);
	// on the rail the logo turns into the expand button on hover
	await sidebar(page).locator('[data-sidebar="header"]').hover();
	await toggle.click();
	await expect.poll(() => railWidth(page)).toBeGreaterThan(200);
	await expect(page.locator("#main > header")).toBeHidden();
	await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});

test("collapsed state survives reload without a jump", async ({ page }) => {
	// record the sidebar's data-state the moment it first enters the DOM (the auth guard renders it client-side)
	await page.addInitScript(() => {
		new MutationObserver((_, obs) => {
			const el = document.querySelector('[data-slot="sidebar"][data-state]');
			if (el) {
				(window as unknown as { firstSidebarState: string }).firstSidebarState = el.getAttribute("data-state")!;
				obs.disconnect();
			}
		}).observe(document, { childList: true, subtree: true });
	});
	await page.context().addCookies([{ name: "sidebar_state", value: "false", domain: "localhost", path: "/" }]);
	await signIn(page);
	await page.goto("/home");
	await expect(sidebar(page)).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as { firstSidebarState: string }).firstSidebarState)).toBe(
		"collapsed",
	);
	expect(await railWidth(page)).toBeCloseTo(56, 0);
});

const palette = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Ask anything" });

test("ctrl+k opens the ask palette and enter hands off", async ({ page }) => {
	const posts: string[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push(r.postDataJSON().query));
	await signIn(page);
	await page.goto("/home");
	await expect(sidebar(page)).toBeVisible();
	await page.keyboard.press("Control+k");
	await expect(palette(page)).toBeVisible();
	await page.getByRole("textbox", { name: "Ask Lumen anything" }).fill("Where did my money go");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/ask$/);
	await expect(page.getByText("Answer to: Where did my money go")).toBeVisible();
	expect(posts).toEqual(["Where did my money go"]);
});

test("ctrl+k works below md with the sheet closed", async ({ page }) => {
	await page.setViewportSize({ width: 767, height: 1024 });
	await signIn(page);
	await page.goto("/home");
	await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
	await page.keyboard.press("Control+k");
	await expect(palette(page)).toBeVisible();
});

test("palette works with caps lock", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	await expect(sidebar(page)).toBeVisible();
	await page.keyboard.press("Control+Shift+K");
	await expect(palette(page)).toBeVisible();
});

test("ask anything button opens the palette", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	await sidebar(page).getByRole("button", { name: /^Ask anything/ }).click();
	await expect(palette(page)).toBeVisible();
});

test("opening the palette does not move the page", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	const main = page.locator("#main");
	await expect(sidebar(page)).toBeVisible();
	const before = await main.boundingBox();
	await page.keyboard.press("Control+k");
	await expect(palette(page)).toBeVisible();
	const after = await main.boundingBox();
	expect(after!.x).toBeCloseTo(before!.x, 0);
	expect(after!.width).toBeCloseTo(before!.width, 0);
});

test("shortcuts ignore text fields", async ({ page }) => {
	await signIn(page);
	await page.goto("/ask");
	const box = page.locator("textarea").first();
	await box.click();
	const before = await railWidth(page);
	await page.keyboard.press("Control+k");
	await page.keyboard.press("Control+b");
	await page.waitForTimeout(300);
	await expect(page).toHaveURL(/\/ask$/);
	await expect(page.getByRole("dialog", { name: "Ask anything" })).toHaveCount(0);
	expect(await railWidth(page)).toBe(before);
});

const accountButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Account menu" });

test("avatar menu has account actions", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	await accountButton(page).click();
	await expect(page.getByRole("menuitem")).toHaveText(["Settings", "API keys", "Log out"]);
	await expect(sidebar(page).getByText("e2e@lumen.test")).toHaveCount(0);
});

test("avatar menu does not move the page", async ({ page }) => {
	await signIn(page);
	for (const p of ["/ask", "/home"]) {
		await page.goto(p);
		const main = page.locator("#main");
		await expect(accountButton(page)).toBeVisible();
		const before = await main.boundingBox();
		await accountButton(page).click();
		await expect(page.getByRole("menu")).toBeVisible();
		const after = await main.boundingBox();
		expect(after!.x, p).toBeCloseTo(before!.x, 0);
		expect(after!.width, p).toBeCloseTo(before!.width, 0);
		await page.keyboard.press("Escape");
	}
});

test("log out returns to the landing page", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	await accountButton(page).click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await expect(page).toHaveURL(/localhost:3100\/$/);
});

test("body is never its own scroll container (it would lose its scrollbar when a menu opens)", async ({ page }) => {
	await signIn(page);
	for (const p of ["/ask", "/home"]) {
		await page.goto(p);
		await expect(accountButton(page)).toBeVisible();
		expect(await page.evaluate(() => getComputedStyle(document.body).overflowY), p).toBe("visible");
	}
});

test("review badge updates after a decision on the same page", async ({ page }) => {
	await signIn(page, { reviewCount: 2 });
	await page.goto("/receipts?tab=review");
	const badge = sidebar(page).locator('[data-sidebar="menu-badge"]');
	await expect(badge).toHaveText("2");
	await page.getByRole("button", { name: "Approve" }).first().click();
	await expect(badge).toHaveText("1");
});

test("mobile: tapping a link closes the sidebar sheet", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	await signIn(page);
	await page.goto("/home");
	await page.getByRole("button", { name: "Toggle Sidebar" }).click();
	const sheet = page.locator('[data-mobile="true"]');
	await expect(sheet).toBeVisible();
	await sheet.getByRole("link", { name: "Spending" }).click();
	await expect(page).toHaveURL(/\/spending$/, { timeout: 20_000 }); // first dev compile of /spending is slow
	await expect(sheet).toBeHidden();
});

test("sidebar never scrolls sideways", async ({ page }) => {
	await signIn(page);
	await page.goto("/home");
	const content = page.locator('[data-sidebar="content"]');
	await expect(content).toBeVisible();
	expect(await content.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
});

test("spending and bills show no cards that can never load", async ({ page }) => {
	await signIn(page, {
		home: { reminders: [{ id: "n", vendor: "Netflix", amount: 649, date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), type: "upcoming" }] },
	});
	await page.goto("/spending");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending");
	for (const dead of ["Could not load payment calendar.", "Could not load reminders.", "Spending Trends"])
		await expect(page.getByText(dead, { exact: true })).toHaveCount(0);
	await page.goto("/bills");
	await expect(page.getByTestId("recurring-table")).toContainText("Netflix");
	await expect(page.getByText(/Could not load/)).toHaveCount(0);
});
