import { test, expect, type Page } from "@playwright/test";

const overlays = [
	["open-dropdown", '[role="menu"]'],
	["open-dialog", '[role="dialog"]'],
	["open-select", '[role="listbox"]'],
	["open-popover", "[data-radix-popper-content-wrapper]"],
	["open-sheet", '[role="dialog"]'],
] as const;

for (const [trigger, surface] of overlays) {
	test(`opening ${trigger} does not move the page`, async ({ page }) => {
		await page.goto("/dev/layout-shift");
		const probe = page.getByTestId("probe");
		const before = await probe.boundingBox();
		await page.getByTestId(trigger).click();
		await expect(page.locator(surface).first()).toBeVisible();
		const after = await probe.boundingBox();
		expect(after!.x).toBeCloseTo(before!.x, 0);
		expect(after!.width).toBeCloseTo(before!.width, 0);
	});
}

// any CSS colour (including oklch) -> [r,g,b] via a 1px canvas
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

test("sky tokens apply to page", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(await rgb(page, bg)).toEqual([244, 243, 239]);
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
});

test("portaled menu is sky", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	await page.getByTestId("open-dropdown").click();
	const bg = await page.locator('[role="menu"]').evaluate((e) => getComputedStyle(e).backgroundColor);
	expect(await rgb(page, bg)).toEqual([255, 255, 255]);
});

test("muted text meets AA", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	const vars = await page.evaluate(() => {
		const s = getComputedStyle(document.documentElement);
		return ["--muted-foreground", "--background", "--sidebar"].map((v) => s.getPropertyValue(v).trim());
	});
	const [m, bg, side] = await Promise.all(vars.map((c) => rgb(page, c)));
	expect(ratio(m, bg)).toBeGreaterThanOrEqual(4.5);
	expect(ratio(m, side)).toBeGreaterThanOrEqual(4.5);
});

test("login stays dark", async ({ page }) => {
	await page.goto("/login");
	const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	const [r] = await rgb(page, bg);
	expect(r).toBeLessThan(60);
});

test("type roles load", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/Funnel/i);
});

test("dark: variants are off inside sky", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	// SelectTrigger is `bg-transparent dark:bg-input/30`; in Sky it must stay transparent.
	const bg = await page.getByTestId("open-select").evaluate((e) => getComputedStyle(e).backgroundColor);
	expect(bg).toBe("rgba(0, 0, 0, 0)");
});
