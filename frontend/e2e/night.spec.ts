import { test, expect, type Page } from "@playwright/test";
import { forecastFixture, signIn, type HomeFixture } from "./fixtures";

// Night is CSS-driven, so these flip the attribute on a normal dev server instead of needing a second build.
async function night(page: Page) {
	await page.evaluate(() => document.querySelector("[data-app-theme]")!.setAttribute("data-app-theme", "night"));
}

// any CSS colour -> [r,g,b] via a 1px canvas
async function rgb(page: Page, css: string) {
	return page.evaluate((c) => {
		const x = document.createElement("canvas").getContext("2d")!;
		x.fillStyle = c;
		x.fillRect(0, 0, 1, 1);
		return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3));
	}, css);
}
const lum = (c: number[]) => {
	const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: number[], b: number[]) => {
	const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (h + 0.05) / (l + 0.05);
};

const thisMonth = (day: number) => {
	const n = new Date();
	return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const tx = (id: string, day: number, total_amount: number) => ({
	id,
	vendor_name: "Swiggy",
	date: thisMonth(day),
	total_amount,
	category: "Food",
	created_at: null,
});
const typical: HomeFixture = { txns: [tx("a", 1, 18412)] };

async function openNightHome(page: Page, home: HomeFixture = typical) {
	await signIn(page, { home });
	await page.goto("/home");
	await expect(page.locator("[data-app-theme]")).toBeAttached();
	await night(page);
	return page.getByTestId("spend-card");
}

test.describe("cards and type", () => {
	test("cards are flat", async ({ page }) => {
		const card = await openNightHome(page);
		// Tailwind's shadow-none computes to transparent layers rather than `none`, so look for anything visible
		const shadow = await card.evaluate((e) => getComputedStyle(e).boxShadow);
		expect(shadow.match(/rgba?\([^)]*\)/g)?.every((c) => /, 0\)$/.test(c)) ?? true).toBe(true);
	});

	test("pages have no band", async ({ page }) => {
		await openNightHome(page);
		await expect(page.getByTestId("sky-band")).toHaveCSS("background-image", "none");
	});

	test("greeting is the serif", async ({ page }) => {
		await openNightHome(page);
		const h1 = page.getByRole("heading", { level: 1 });
		await expect(h1).toHaveCSS("font-weight", "300");
		expect(await h1.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/Newsreader/i);
	});

	test("figures are regular weight and tabular", async ({ page }) => {
		const card = await openNightHome(page);
		const figure = card.getByTestId("spend-figure");
		await expect(figure).toHaveCSS("font-weight", "400");
		await expect(figure).toHaveCSS("font-variant-numeric", /tabular-nums/);
	});

	test("pressing a button gives feedback", async ({ page }) => {
		const card = await openNightHome(page);
		const week = card.getByRole("button", { name: "1W" });
		await week.hover();
		await page.mouse.down();
		await expect(week).toHaveCSS("scale", "0.97");
		await page.mouse.up();
	});

	test("a spike icon stays readable", async ({ page }) => {
		await openNightHome(page, {
			...typical,
			summary: { found: [{ kind: "spike", tag: "SPIKE", headline: "Food doubled", detail: "Look.", amounts: [], worth: null, href: "/spending" }] },
		});
		const icon = page.getByTestId("found-row").locator("span").first();
		const [color, card] = await icon.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(document.documentElement).getPropertyValue("--card").trim()]);
		expect(ratio(await rgb(page, color), await rgb(page, card))).toBeGreaterThanOrEqual(4.5);
	});

	test("loading does not change card height", async ({ page }) => {
		const card = await openNightHome(page, { ...typical, delayMs: 1500 });
		await expect(card.locator('[data-slot="skeleton"]')).toBeVisible();
		const loading = (await card.boundingBox())!.height;
		await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
		expect((await card.boundingBox())!.height).toBeCloseTo(loading, 0);
	});
});

test.describe("charts and calendar", () => {
	test("running total is cyan, forecast is violet", async ({ page }) => {
		const card = await openNightHome(page, {
			txns: [tx("a", 1, 18412), tx("b", 1, 100)],
			forecast: forecastFixture({ spent: 18512, perDay: 500 }),
		});
		const stroke = (series: string) => card.locator(`[data-series="${series}"]`).evaluate((e) => getComputedStyle(e).stroke);
		await expect(card.locator('[data-series="current"]')).toBeAttached();
		expect(await rgb(page, await stroke("current"))).toEqual([0, 179, 221]);
		await expect(card.locator('[data-series="forecast"]')).toBeAttached();
		expect(await rgb(page, await stroke("forecast"))).toEqual([164, 158, 255]);
	});

	// day 1 at the top of the scale, day 2 at the bottom
	const calendar: HomeFixture = { txns: [tx("a", 1, 50000), tx("b", 2, 100)] };
	const cellContrast = (page: Page, day: number) =>
		page.getByTestId(`cal-day-${day}`).evaluate((e) => {
			const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
			const s = getComputedStyle(e);
			canvas.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim();
			canvas.fillRect(0, 0, 1, 1);
			canvas.fillStyle = s.backgroundColor;
			canvas.fillRect(0, 0, 1, 1);
			const bg = Array.from(canvas.getImageData(0, 0, 1, 1).data.slice(0, 3));
			canvas.fillStyle = s.color;
			canvas.fillRect(0, 0, 1, 1);
			return [Array.from(canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)), bg];
		});

	for (const day of [1, 2]) {
		test(`calendar text is readable on day ${day}`, async ({ page }) => {
			await openNightHome(page, calendar);
			await expect(page.getByTestId(`cal-day-${day}`)).toBeVisible();
			const [text, bg] = await cellContrast(page, day);
			expect(ratio(text, bg)).toBeGreaterThanOrEqual(4.5);
		});
	}

	test("sky calendar is unchanged", async ({ page }) => {
		await signIn(page, { home: calendar });
		await page.goto("/home");
		const cell = page.getByTestId("cal-day-1");
		await expect(cell).toHaveCSS("color", "rgb(255, 255, 255)");
		// 0.85 of the primary colour at the top of the scale
		const bg = await cell.evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(bg).toMatch(/0\.85\)$/);
	});
});

test.describe("review fixes", () => {
	test("vendor chips sit quietly on the dark card", async ({ page }) => {
		await openNightHome(page);
		const chip = page.getByTestId("recent-row").locator("[data-vendor-chip]");
		const [bg, color] = await chip.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
		const [b, c] = [await rgb(page, bg), await rgb(page, color)];
		expect(lum(b)).toBeLessThan(0.05);
		expect(ratio(c, b)).toBeGreaterThanOrEqual(4.5);
	});

	test("the avatar doesn't compete with the main action", async ({ page }) => {
		await openNightHome(page);
		const fallback = page.getByRole("button", { name: "Account menu" }).locator('[data-slot="avatar-fallback"]');
		const bg = await fallback.first().evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(lum(await rgb(page, bg))).toBeLessThan(0.05);
	});

	test("a large amount fits its calendar cell on a laptop", async ({ page }) => {
		await page.setViewportSize({ width: 1265, height: 900 });
		await openNightHome(page, { txns: [tx("a", 1, 22000)] });
		const amount = page.getByTestId("cal-day-1").locator("b");
		const [scroll, client] = await amount.evaluate((e) => [e.scrollWidth, e.clientWidth]);
		expect(scroll).toBeLessThanOrEqual(client);
	});
});

test.describe("motion", () => {
	test("page change uses the night transition", async ({ page }) => {
		await openNightHome(page);
		const wrap = page.locator(".app-page-in");
		await expect(wrap).toHaveCSS("animation-name", "night-page-in");
		await expect(wrap).toHaveCSS("animation-duration", "0.2s");
	});

	test("reduced motion drops the page slide", async ({ browser }) => {
		const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: test.info().project.use.baseURL });
		const page = await ctx.newPage();
		await openNightHome(page);
		await expect(page.locator(".app-page-in")).toHaveCSS("animation-name", "none");
		await ctx.close();
	});

	test("menus open fast and float", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await page.getByTestId("open-dropdown").click();
		const menu = page.locator('[role="menu"]');
		await expect(menu).toHaveCSS("animation-duration", "0.16s");
		expect(await menu.evaluate((e) => getComputedStyle(e).boxShadow)).toContain("60px");
	});

	test("dialogs sit above the page, not below it", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await page.getByTestId("open-dialog").click();
		const bg = await page.locator('[role="dialog"]').evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(await rgb(page, bg)).toEqual([35, 35, 37]);
	});

	test("keyboard focus is visible", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await page.keyboard.press("Tab");
		const [style, width] = await page.evaluate(() => {
			const s = getComputedStyle(document.activeElement!);
			return [s.outlineStyle, s.outlineWidth];
		});
		expect([style, width]).toEqual(["solid", "2px"]);
	});
});

test.describe("tokens", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
	});

	test("night tokens apply", async ({ page }) => {
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		expect(await rgb(page, bg)).toEqual([11, 11, 12]);
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
	});

	test("portaled menu is night", async ({ page }) => {
		await page.getByTestId("open-dropdown").click();
		const bg = await page.locator('[role="menu"]').evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(await rgb(page, bg)).toEqual([35, 35, 37]);
	});

	test("muted text meets AA everywhere", async ({ page }) => {
		const vars = await page.evaluate(() => {
			const s = getComputedStyle(document.documentElement);
			return ["--muted-foreground", "--background", "--card", "--popover", "--sidebar"].map((v) => s.getPropertyValue(v).trim());
		});
		const [m, ...surfaces] = await Promise.all(vars.map((c) => rgb(page, c)));
		for (const s of surfaces) expect(ratio(m, s)).toBeGreaterThanOrEqual(4.5);
	});

	test("bui tokens follow night", async ({ page }) => {
		const bg = await page.getByTestId("bui-probe").evaluate((e) => getComputedStyle(e).backgroundColor);
		expect(await rgb(page, bg)).toEqual([11, 11, 12]);
	});
});
