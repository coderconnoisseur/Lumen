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
