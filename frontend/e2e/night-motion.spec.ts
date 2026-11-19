import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./fixtures";

async function night(page: Page) {
	await page.evaluate(() => document.querySelector("[data-app-theme]")!.setAttribute("data-app-theme", "night"));
}

// every animation that starts on a floating layer, as "slot:keyframes"
async function recordAnimations(page: Page) {
	await page.evaluate(() => {
		const started: string[] = ((window as unknown as { started: string[] }).started = []);
		document.addEventListener("animationstart", (e) => {
			const slot = (e.target as Element).getAttribute("data-slot");
			if (slot) started.push(`${slot}:${e.animationName}`);
		});
	});
}
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { started: string[] }).started);

const layers: [string, string, string][] = [
	["open-dropdown", "dropdown-menu-content", "float"],
	["open-popover", "popover-content", "float"],
	["open-dialog", "dialog-content", "float"],
	["open-dialog", "dialog-overlay", "fade"],
	["open-sheet", "sheet-content", "sheet"],
	["open-sheet", "sheet-overlay", "fade"],
];

async function open(page: Page, trigger: string, slot: string) {
	await page.getByTestId(trigger).click();
	const layer = page.locator(`[data-slot="${slot}"]`);
	await expect(layer).toBeVisible();
	return layer;
}

for (const [trigger, slot, kind] of layers) {
	test(`${slot} animates`, async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await recordAnimations(page);
		const layer = await open(page, trigger, slot);
		await page.waitForTimeout(400);
		expect(await recorded(page)).toContain(`${slot}:night-${kind}-in`);
		await page.keyboard.press("Escape");
		// Radix removes the overlay as soon as a dialog closes, so only the content has an exit
		if (kind !== "fade") await expect.poll(() => recorded(page)).toContain(`${slot}:night-${kind}-out`);
		await expect(layer).toHaveCount(0);
	});

	test(`${slot} stays still with reduced motion`, async ({ browser }) => {
		const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: test.info().project.use.baseURL });
		const page = await ctx.newPage();
		await page.goto("/dev/layout-shift");
		await night(page);
		const layer = await open(page, trigger, slot);
		await expect(layer).toHaveCSS("animation-name", "none");
		await page.keyboard.press("Escape");
		await expect(layer).toHaveCount(0);
		await ctx.close();
	});

	test(`${slot} stays still in Sky`, async ({ page }) => {
		await page.goto("/dev/layout-shift");
		const layer = await open(page, trigger, slot);
		await expect(layer).toHaveCSS("animation-name", "none");
		await page.keyboard.press("Escape");
		await expect(layer).toHaveCount(0);
	});
}

test("a select opens with the menus' animation", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	await night(page);
	await expect(await open(page, "open-select", "select-content")).toHaveCSS("animation-name", "night-float-in");
});

// the animation's first frame: where the layer starts from
const firstFrame = (page: Page, selector: string) =>
	page.locator(selector).evaluate((e) => {
		const [animation] = e.getAnimations();
		animation.pause();
		animation.currentTime = 0;
		const r = e.getBoundingClientRect();
		return { left: r.left, right: r.right, opacity: getComputedStyle(e).opacity, pageWidth: document.documentElement.clientWidth };
	});

test("a dialog stays centred while it scales in", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	await night(page);
	await page.getByTestId("open-dialog").click();
	const { left, right, opacity, pageWidth } = await firstFrame(page, '[data-slot="dialog-content"]');
	expect(opacity).toBe("0");
	expect((left + right) / 2).toBeCloseTo(pageWidth / 2, 0);
});

test("a menu starts from its trigger", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	await night(page);
	const menu = await open(page, "open-dropdown", "dropdown-menu-content");
	// the trigger is above this menu, so the origin sits at its top edge rather than its middle
	const originY = await menu.evaluate((e) => parseFloat(getComputedStyle(e).transformOrigin.split(" ")[1]));
	expect(originY).toBeLessThan(10);
});

test("a sheet slides in from its own side", async ({ page }) => {
	await page.goto("/dev/layout-shift");
	await night(page);
	await page.getByTestId("open-sheet").click();
	const { left, pageWidth } = await firstFrame(page, '[data-slot="sheet-content"]');
	expect(left).toBeGreaterThanOrEqual(pageWidth);
});

test("the phone sidebar slides in from the left", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await signIn(page, { home: { txns: [] } });
	await page.goto("/home");
	await expect(page.locator("[data-app-theme]")).toBeAttached();
	await night(page);
	const sidebar = page.locator('[data-mobile="true"]');
	await expect(async () => {
		await page.locator('[data-sidebar="trigger"]:visible').first().click(); // retried: the page may still be hydrating
		await expect(sidebar).toBeVisible({ timeout: 1000 });
	}).toPass();
	const { right } = await firstFrame(page, '[data-mobile="true"]');
	expect(right).toBeLessThanOrEqual(0);
});
