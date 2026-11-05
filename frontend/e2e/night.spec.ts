import { test, expect, type Page } from "@playwright/test";
// @ts-expect-error eslint 8 ships no types
import { ESLint } from "eslint";
import { budgetHeroOverlaps, forecastFixture, signIn, type HomeFixture } from "./fixtures";

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

test.describe("review findings", () => {
	test("the focused menu item stands out from the menu", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await page.getByTestId("open-dropdown").click();
		const item = page.locator('[role="menuitem"]').first();
		await item.focus();
		await expect
			.poll(async () => {
				const [i, m] = await item.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e.closest('[role="menu"]')!).backgroundColor]);
				return ratio(await rgb(page, i), await rgb(page, m));
			})
			.toBeGreaterThan(1.1);
	});

	test("select panels are night too", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await page.getByTestId("open-select").click();
		const bg = await page.locator('[role="listbox"]').evaluate((e) => getComputedStyle(e.closest('[data-slot="select-content"]') ?? e).backgroundColor);
		expect(await rgb(page, bg)).toEqual([35, 35, 37]);
	});

	for (const width of [1265, 1280]) {
		test(`a four-digit amount fits its calendar cell at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await openNightHome(page, { txns: [tx("a", 1, 3465)] });
			const amount = page.getByTestId("cal-day-1").locator("b");
			await expect(amount).toBeVisible();
			const [scroll, client] = await amount.evaluate((e) => [e.scrollWidth, e.clientWidth]);
			expect(scroll).toBeLessThanOrEqual(client);
		});
	}

	test("the default button is white, not blue", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		const [bg, color] = await page.evaluate(() => {
			const b = document.createElement("button");
			b.className = "bg-blue-600 text-white";
			document.body.append(b);
			const s = getComputedStyle(b);
			return [s.backgroundColor, s.color];
		});
		expect(await rgb(page, bg)).toEqual([255, 255, 255]);
		expect(await rgb(page, color)).toEqual([0, 0, 0]);
	});

	test("the shared button transition keeps fades and leaves the sidebar alone", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/home");
		const side = page.locator('button[data-slot="sidebar-menu-button"]').first();
		await expect(side).toBeAttached();
		const sky = await side.evaluate((e) => getComputedStyle(e).transitionProperty);
		await night(page);
		expect(await side.evaluate((e) => getComputedStyle(e).transitionProperty)).toBe(sky);
		const other = page.getByRole("button", { name: "1W" });
		expect(await other.evaluate((e) => getComputedStyle(e).transitionProperty)).toContain("opacity");
	});

	test("calendar weekday letters pass AA at a readable size", async ({ page }) => {
		await openNightHome(page);
		const letter = page.getByTestId("calendar-card").locator('[class~="text-muted-foreground/70"]').first();
		await expect(letter).toBeAttached();
		const [color, size, card] = await letter.evaluate((e) => [getComputedStyle(e).color, parseFloat(getComputedStyle(e).fontSize), getComputedStyle(document.documentElement).getPropertyValue("--card").trim()]);
		expect(size).toBeGreaterThanOrEqual(11);
		expect(ratio(await rgb(page, color as string), await rgb(page, card as string))).toBeGreaterThanOrEqual(4.5);
	});

	test("white text on the red confirm becomes dark", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		const [bg, color] = await page.evaluate(() => {
			const b = document.createElement("button");
			b.className = "bg-bad text-white";
			document.body.append(b);
			const s = getComputedStyle(b);
			return [s.backgroundColor, s.color];
		});
		expect(ratio(await rgb(page, color), await rgb(page, bg))).toBeGreaterThanOrEqual(4.5);
	});
});

test.describe("other pages", () => {
	test("an on toggle keeps a visible knob", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/spending");
		await expect(page.getByText("Compare with")).toBeVisible();
		await night(page);
		const knob = page.locator(".bg-primary > .bg-white").first();
		await expect(knob).toBeAttached();
		const [k, track] = await knob.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e.parentElement!).backgroundColor]);
		expect(ratio(await rgb(page, k), await rgb(page, track))).toBeGreaterThanOrEqual(3);
	});

	test("category colours follow the theme", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/spending");
		const dot = page.getByTestId("category-row").first().locator("i").first();
		await expect(dot).toBeAttached();
		await night(page);
		expect(await rgb(page, await dot.evaluate((e) => getComputedStyle(e).backgroundColor))).toEqual([0, 145, 181]);
	});

	test("Ask's prompt bar sits above the page", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/ask");
		const bar = page.locator(".bg-canvas").first();
		await expect(bar).toBeVisible();
		await night(page);
		// the bar has a colour transition, so give the flip a moment to land
		await expect.poll(async () => rgb(page, await bar.evaluate((e) => getComputedStyle(e).backgroundColor))).toEqual([22, 22, 23]);
	});

	test("page hero figures share Night's type", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/spending");
		const figure = page.locator('.tabular-nums[class~="text-[36px]"]').first();
		await expect(figure).toBeAttached();
		await night(page);
		await expect(figure).toHaveCSS("font-weight", "400");
		await expect(figure).toHaveCSS("font-size", "34px");
	});

	test("buttons don't select on a long press", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		await expect(page.getByTestId("open-dropdown")).toHaveCSS("user-select", "none");
	});

	test("sky category colours are unchanged", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/spending");
		const dot = page.getByTestId("category-row").first().locator("i").first();
		await expect(dot).toBeAttached();
		expect(await rgb(page, await dot.evaluate((e) => getComputedStyle(e).backgroundColor))).toEqual([47, 111, 224]);
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

test.describe("known issues", () => {
	test("pull-to-refresh still works", async ({ page }) => {
		await openNightHome(page);
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("auto");
	});

	test("the Ctrl+K palette doesn't animate at all, backdrop included", async ({ page }) => {
		await openNightHome(page);
		await page.evaluate(() => {
			const started: string[] = ((window as unknown as { started: string[] }).started = []);
			document.addEventListener("animationstart", (e) => {
				const slot = (e.target as Element).getAttribute("data-slot");
				if (slot?.startsWith("dialog-")) started.push(slot);
			});
		});
		await page.keyboard.press("Control+k");
		const palette = page.locator('[data-slot="dialog-content"]');
		await expect(palette).toBeVisible();
		await page.waitForTimeout(100);
		await page.keyboard.press("Escape");
		await expect(palette).toHaveCount(0);
		expect(await page.evaluate(() => (window as unknown as { started: string[] }).started)).toEqual([]);
	});

	// Tailwind's unset ring layers compute to transparent, so look for anything visible
	const visibleShadow = (s: string) => s.split(/,(?![^()]*\))/).some((layer) => !layer.includes("rgba(0, 0, 0, 0)") && /[1-9]\d*px/.test(layer));

	test("a focused button shows the outline and nothing else", async ({ page }) => {
		await page.goto("/dev/layout-shift");
		await night(page);
		const button = page.getByTestId("open-dialog");
		await button.evaluate((e) => e.classList.add("border")); // as the outline variant has, so its colour can show
		while (!(await button.evaluate((e) => e === document.activeElement))) await page.keyboard.press("Tab");
		await page.waitForTimeout(300); // box-shadow and border colour have transitions
		const [shadow, style, border] = await button.evaluate((e) => {
			const s = getComputedStyle(e);
			return [s.boxShadow, s.outlineStyle, s.borderTopColor];
		});
		expect(style).toBe("solid");
		expect(visibleShadow(shadow)).toBe(false);
		expect(await rgb(page, border)).not.toEqual([164, 158, 255]);
	});

	for (const collapsed of [false, true]) {
		test(`a focused sidebar item has one outline, unclipped${collapsed ? ", collapsed" : ""}`, async ({ page }) => {
			await openNightHome(page);
			if (collapsed) await page.keyboard.press("Control+b");
			await page.waitForTimeout(300); // the rail's width transition
			while (!(await page.evaluate(() => !!document.activeElement?.closest('[data-sidebar="menu-button"]')))) await page.keyboard.press("Tab");
			await page.waitForTimeout(300); // box-shadow has a transition
			const [shadow, clipped] = await page.evaluate(() => {
				const e = document.activeElement!;
				const s = getComputedStyle(e);
				const reach = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
				const r = e.getBoundingClientRect();
				let clip = false;
				for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
					if (getComputedStyle(a).overflow === "visible") continue;
					const b = a.getBoundingClientRect();
					clip ||= r.left - reach < b.left || r.right + reach > b.right;
				}
				return [s.boxShadow, clip] as const;
			});
			expect(visibleShadow(shadow)).toBe(false);
			expect(clipped).toBe(false);
		});
	}

	test("a full-width row doesn't shrink when pressed, but still answers", async ({ page }) => {
		await signIn(page, { home: typical });
		await page.goto("/spending");
		const row = page.getByTestId("category-row").first();
		await expect(row).toBeVisible();
		await night(page);
		await row.hover();
		await page.mouse.down();
		await expect.poll(async () => rgb(page, await row.evaluate((e) => getComputedStyle(e).backgroundColor))).toEqual([35, 35, 37]);
		await expect(row).toHaveCSS("scale", "none");
		await page.mouse.up();
	});

	const short: [number, string][] = [
		[9999, "10k"],
		[123_456, "123k"],
		[999_400, "999k"],
		[999_600, "1.0M"],
		[1_500_000, "1.5M"],
		[12_345_678, "12M"],
		[2_500_000_000, "2.5B"],
		[123_456_789_012, "123B"],
	];
	for (const [amount, text] of short) {
		for (const [width, theme] of [[375, "night"], [1265, "night"], [375, "sky"], [1265, "sky"]] as const) {
			// Sky's symbol still clips under six figures on a laptop, as it always has
			if (theme === "sky" && width === 1265 && amount < 100_000) continue;
			test(`a calendar cell shows ${amount} as ${text} at ${width}px in ${theme}`, async ({ page }) => {
				await page.setViewportSize({ width, height: 900 });
				await signIn(page, { home: { txns: [tx("a", 1, amount)] } });
				await page.goto("/home");
				if (theme === "night") await night(page);
				const b = page.getByTestId("cal-day-1").locator("b");
				await expect(b).toContainText(text);
				const [scroll, client] = await b.evaluate((e) => [e.scrollWidth, e.clientWidth]);
				expect(scroll).toBeLessThanOrEqual(client);
			});
		}
	}

	for (const amount of [999_999_999, 99_999_999_999, 999_999_999_999]) {
		for (const theme of ["sky", "night"]) {
			test(`budget hero holds ${amount} on a phone in ${theme}`, async ({ page }) => {
				await page.setViewportSize({ width: 375, height: 812 });
				await signIn(page, { home: { ...typical, budget: { monthly_budget: amount, spent: Math.floor(amount / 2), categories: [] } } });
				await page.goto("/budget");
				await expect(page.getByTestId("left")).toBeVisible();
				if (theme === "night") await night(page);
				expect(await budgetHeroOverlaps(page)).toEqual([]);
			});
		}
	}

	test("a normal budget hero keeps its one-line figure and three stats", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await signIn(page, { home: { ...typical, budget: { monthly_budget: 60000, spent: 18412, categories: [] } } });
		await page.goto("/budget");
		await expect(page.getByTestId("left")).toBeVisible();
		const row = page.getByTestId("budget-hero").locator('[class~="h-11"]');
		await expect(row).toHaveCSS("height", "44px");
		await expect(row).toHaveCSS("font-size", "36px");
		const tops = await Promise.all(["left", "days-left", "per-day"].map(async (id) => (await page.getByTestId(id).boundingBox())!.y));
		expect(new Set(tops).size).toBe(1);
	});

	test("lint refuses a direct lucide-react import outside the icon files", async () => {
		const eslint = new ESLint();
		const code = 'import { Star } from "lucide-react";\nexport const s = Star;\n';
		const rules = async (filePath: string) => (await eslint.lintText(code, { filePath }))[0].messages.map((m: { ruleId: string }) => m.ruleId);
		expect(await rules("src/components/anything.tsx")).toContain("no-restricted-imports");
		expect(await rules("src/components/icons.tsx")).not.toContain("no-restricted-imports");
		expect(await rules("src/components/icons.night.tsx")).not.toContain("no-restricted-imports");
	});
});
