import { test, expect } from "@playwright/test";

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
