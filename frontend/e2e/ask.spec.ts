import { test, expect, type Page } from "@playwright/test";
import { signIn, type ChatFixture } from "./fixtures";

const spike = { kind: "spike", tag: "SPENDING", subject: "Food", headline: "Food is up 35%", detail: "{0} vs {1}",
	amounts: [6750, 5000], worth: null, href: "/spending" };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const old: ChatFixture = {
	threads: [
		{ id: "a", title: "Food last month", updated_at: hoursAgo(2), message_count: 2,
			messages: [{ role: "user", content: "Food last month" }, { role: "assistant", content: "You spent ₹7,480 on food." }] },
		{ id: "b", title: "Bills due", updated_at: hoursAgo(30), message_count: 2,
			messages: [{ role: "user", content: "Bills due" }, { role: "assistant", content: "Netflix on Friday." }] },
	],
};

async function openAsk(page: Page, chat: ChatFixture = {}, url = "/ask") {
	await signIn(page, { chat, home: { summary: { found: [spike] } } });
	await page.goto(url);
}
const composer = (page: Page) => page.getByRole("textbox", { name: "Ask Lumen" }).last();
const rail = (page: Page) => page.getByTestId("thread-rail");

test("fresh chat shows suggestions", async ({ page }) => {
	await openAsk(page, { ...old, suggestions: ["Which vendor did I spend the most with?"] });
	await expect(page.getByRole("button", { name: "Why is Food up this month?" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Which vendor did I spend the most with?" })).toBeVisible();
	await expect(page.getByText("You spent ₹7,480 on food.")).toHaveCount(0); // opens fresh, not the last chat
});

test("sending creates a thread in the rail", async ({ page }) => {
	await openAsk(page);
	await composer(page).fill("How much on groceries?");
	await composer(page).press("Enter");
	await expect(page.getByText("Answer to: How much on groceries?")).toBeVisible();
	await expect(rail(page).getByRole("button", { name: /^How much on groceries\?/ })).toBeVisible();
	await expect(rail(page).getByRole("button", { name: /^How much on groceries\?/ })).toHaveAttribute("aria-current", "page");
});

test("follow-ups stay in the same thread", async ({ page }) => {
	await openAsk(page);
	const posts: { thread_id?: string }[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push(r.postDataJSON()));
	await composer(page).fill("First");
	await composer(page).press("Enter");
	await expect(page.getByText("Answer to: First")).toBeVisible();
	await composer(page).fill("And then?");
	await composer(page).press("Enter");
	await expect(page.getByText("Answer to: And then?")).toBeVisible();
	expect(posts[0].thread_id).toBeUndefined();
	expect(posts[1].thread_id).toBe("t1");
});

test("selecting a thread loads its messages", async ({ page }) => {
	await openAsk(page, old);
	await rail(page).getByRole("button", { name: /^Bills due/ }).click();
	await expect(page.getByText("Netflix on Friday.")).toBeVisible();
});

test("new chat clears the conversation", async ({ page }) => {
	await openAsk(page, old);
	await rail(page).getByRole("button", { name: /^Bills due/ }).click();
	await expect(page.getByText("Netflix on Friday.")).toBeVisible();
	await page.getByRole("button", { name: "New chat" }).first().click();
	await expect(page.getByText("Netflix on Friday.")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Why is Food up this month?" })).toBeVisible();
});

test("deleting a thread removes it", async ({ page }) => {
	await openAsk(page, old);
	await rail(page).getByRole("button", { name: /^Bills due/ }).hover();
	await rail(page).getByRole("button", { name: "Delete chat: Bills due" }).click();
	await rail(page).getByRole("button", { name: "Confirm delete" }).click();
	await expect(rail(page).getByRole("button", { name: /^Bills due/ })).toHaveCount(0);
});

test("rail actions wait for the answer", async ({ page }) => {
	await openAsk(page, { ...old, delayMs: 1500 });
	await rail(page).getByRole("button", { name: "Delete chat: Bills due" }).click();
	await expect(rail(page).getByRole("button", { name: "Keep" })).toBeFocused();
	await composer(page).fill("Slow one");
	await composer(page).press("Enter");
	await expect(rail(page).getByRole("button", { name: "Keep" })).toBeDisabled();
	await expect(rail(page).getByRole("button", { name: "Confirm delete" })).toBeDisabled();
	await expect(rail(page).getByRole("button", { name: "Delete chat: Food last month" })).toBeDisabled();
	await expect(page.getByText("Answer to: Slow one")).toBeVisible();
	await expect(rail(page).getByRole("button", { name: "Keep" })).toBeEnabled();
});

test("the trash button shows without hover at phone width", async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await openAsk(page, old);
	await page.getByRole("button", { name: "History" }).click();
	const trash = rail(page).getByRole("button", { name: "Delete chat: Bills due" });
	await expect(trash).toBeVisible();
	await expect(trash).toHaveCSS("opacity", "1");
});

test("handoff sends once", async ({ page }) => {
	const posts: string[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push(r.postDataJSON().query));
	await openAsk(page, {}, "/ask?q=How%20much%20on%20food");
	await expect(page.getByText("Answer to: How much on food")).toBeVisible();
	await expect(page).toHaveURL(/\/ask$/);
	await page.reload();
	await expect(rail(page).getByRole("button", { name: /^How much on food/ })).toBeVisible();
	await page.waitForTimeout(500);
	expect(posts).toEqual(["How much on food"]);
});

test("blank q sends nothing", async ({ page }) => {
	const posts: string[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push("x"));
	await openAsk(page, {}, "/ask?q=%20%20");
	await expect(page.getByRole("button", { name: "Why is Food up this month?" })).toBeVisible();
	await page.waitForTimeout(500);
	expect(posts).toEqual([]);
});

test("a bare Next: line is never shown", async ({ page }) => {
	await openAsk(page, { answer: "Which period would you like?\nNext:" });
	await composer(page).fill("Summary please");
	await composer(page).press("Enter");
	await expect(page.getByText("Which period would you like?")).toBeVisible();
	await expect(page.locator("#main")).not.toContainText("Next:");
});

test("thread rail does not move the conversation", async ({ page }) => {
	await openAsk(page, old);
	const column = page.getByTestId("ask-column");
	await expect(rail(page).getByRole("button", { name: /^Food last month/ })).toBeVisible();
	const before = await column.boundingBox();
	await rail(page).getByRole("button", { name: /^Food last month/ }).click();
	await expect(page.getByText("You spent ₹7,480 on food.")).toBeVisible();
	const after = await column.boundingBox();
	expect(after!.x).toBeCloseTo(before!.x, 0);
	expect(after!.width).toBeCloseTo(before!.width, 0);
});

test("the open thread is highlighted readably, not in the brand blue", async ({ page }) => {
	await openAsk(page, old);
	const row = rail(page).getByRole("button", { name: /^Food last month/ });
	await row.click();
	await expect(row).toHaveAttribute("aria-current", "page");
	const [r, g, b] = await row.evaluate((e) => {
		const x = document.createElement("canvas").getContext("2d")!;
		x.fillStyle = getComputedStyle(e).backgroundColor;
		x.fillRect(0, 0, 1, 1);
		return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3));
	});
	expect(Math.min(r, g, b)).toBeGreaterThan(180); // a light tint, so the dark title and time stay readable
});

test("asking from the palette while on Ask starts a clean new chat, every time", async ({ page }) => {
	const posts: { query: string; thread_id?: string }[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push(r.postDataJSON()));
	await openAsk(page, old);
	await rail(page).getByRole("button", { name: /^Food last month/ }).click();
	await expect(page.getByText("You spent ₹7,480 on food.")).toBeVisible();
	for (const q of ["foo", "bar"]) {
		await page.locator("body").click({ position: { x: 900, y: 60 } });
		await page.keyboard.press("Control+k");
		await page.getByRole("textbox", { name: "Ask Lumen anything" }).fill(q);
		await page.keyboard.press("Enter");
		await expect(page.getByText(`Answer to: ${q}`)).toBeVisible();
		await expect(page.getByText("You spent ₹7,480 on food.")).toHaveCount(0);
		await expect(page).toHaveURL(/\/ask$/);
	}
	expect(posts.map((p) => [p.query, p.thread_id])).toEqual([["foo", undefined], ["bar", undefined]]);
});

test("the send button looks different when it can send", async ({ page }) => {
	await openAsk(page);
	const send = page.getByRole("button", { name: "Send" }).first();
	const bg = () => send.evaluate((e) => {
		const x = document.createElement("canvas").getContext("2d")!;
		x.fillStyle = getComputedStyle(e).backgroundColor;
		x.fillRect(0, 0, 1, 1);
		return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 4));
	});
	await page.waitForTimeout(400); // the button animates its background for 200ms
	const off = await bg();
	await composer(page).fill("Something");
	await page.waitForTimeout(400);
	const on = await bg();
	const lum = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * (c[3] / 255) + 244 * (1 - c[3] / 255);
	expect(Math.abs(lum(on) - lum(off))).toBeGreaterThan(80); // a dark filled button vs a faint one on the light page
});

test("an upload suggestion opens the upload dialog instead of asking Lumen", async ({ page }) => {
	await openAsk(page, { followUp: "Upload an invoice or receipt to get started." });
	await composer(page).fill("Do I have invoices?");
	await composer(page).press("Enter");
	const chip = page.getByRole("link", { name: "Upload an invoice or receipt to get started" });
	await expect(chip).toHaveAttribute("href", "/home?upload=1");
	await chip.click();
	await expect(page).toHaveURL(/\/home\?upload=1$/);
	await expect(page.getByRole("dialog")).toBeVisible();
});

test("a question suggestion is still sent to Lumen", async ({ page }) => {
	await openAsk(page, { followUp: "Show last month by category" });
	await composer(page).fill("How much did I spend?");
	await composer(page).press("Enter");
	await page.getByRole("button", { name: "Show last month by category" }).click();
	await expect(page.getByText("Answer to: Show last month by category")).toBeVisible();
});

test("draft prefills the composer without sending", async ({ page }) => {
	const posts: string[] = [];
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push("x"));
	await openAsk(page, {}, "/ask?draft=Why%20is%20Food%20up%3F");
	await expect(composer(page)).toHaveValue("Why is Food up?");
	await expect(composer(page)).toBeFocused();
	await expect(page).toHaveURL(/\/ask$/);
	await page.waitForTimeout(500);
	expect(posts).toHaveLength(0);
	await page.reload();
	await expect(composer(page)).toHaveValue("");
});

test("a sent draft doesn't come back in the follow-up box", async ({ page }) => {
	await openAsk(page, {}, "/ask?draft=Why%20is%20Food%20up%3F");
	await composer(page).press("Enter");
	await expect(page.getByText("Answer to: Why is Food up?")).toBeVisible();
	await expect(composer(page)).toHaveValue("");
});

test("a late answer can't take over a chat started after it", async ({ page }) => {
	const posts: { query: string; thread_id?: string | null }[] = [];
	const threadOf: Record<string, string> = {};
	page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/chat") && posts.push(r.postDataJSON()));
	page.on("response", async (r) => {
		if (r.request().method() === "POST" && r.url().endsWith("/chat"))
			threadOf[r.request().postDataJSON().query] = (await r.json()).data.thread_id;
	});
	// the first question answers after the second one
	await openAsk(page, { delayMs: (q) => (q === "Slow one" ? 2500 : 100) });
	await composer(page).fill("Slow one");
	await composer(page).press("Enter");
	// the Ask anything palette hands off to /ask?q= in the same page: a new chat while the first answer is in flight
	await page.getByRole("button", { name: /^Ask anything/ }).click();
	const palette = page.getByRole("dialog", { name: "Ask anything" });
	await palette.getByRole("textbox").fill("Fast one");
	await palette.getByRole("textbox").press("Enter");
	await expect(page.getByText("Answer to: Fast one")).toBeVisible();
	await page.waitForTimeout(3000); // the slow answer lands now
	await expect(page.getByText("Answer to: Slow one")).toHaveCount(0);
	await composer(page).fill("And a follow-up");
	await composer(page).press("Enter");
	await expect(page.getByText("Answer to: And a follow-up")).toBeVisible();
	const fast = posts.find((p) => p.query === "Fast one")!;
	const follow = posts.find((p) => p.query === "And a follow-up")!;
	expect(fast.thread_id ?? null).toBeNull();
	// the follow-up goes into the Fast chat's thread, never the slow one's
	expect(follow.thread_id).toBe(threadOf["Fast one"]);
	expect(threadOf["Fast one"]).not.toBe(threadOf["Slow one"]);
});
