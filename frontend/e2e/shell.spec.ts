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
