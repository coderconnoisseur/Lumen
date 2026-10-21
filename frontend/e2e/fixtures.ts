import type { Page } from "@playwright/test";

// Fake a signed-in user without Supabase or the backend. Call before page.goto.
// - supabase-js reads a non-expired session from localStorage without a network call
//   (key = sb-<first label of NEXT_PUBLIC_SUPABASE_URL host>-auth-token; the e2e host is 127.0.0.1).
// - the `lumen_session` cookie gets past middleware.
// - every backend call (NEXT_PUBLIC_BACKEND_URL in playwright.config.ts) is stubbed.
export type HomeFixture = {
	txns?: { id: string; vendor_name: string; date: string; total_amount: number; category: string | null; created_at: string | null }[];
	reminders?: { id: string; vendor: string; amount: number; date: string; type: string; category?: string }[];
	forecast?: { dates: string[]; values: number[] } | "fail";
	delayMs?: number;
	forecastDelayMs?: number;
	/** GET /api/home/summary; default: just the review item when reviewCount > 0 */
	summary?: { found: object[]; more?: number; worth_total?: number; activity?: object[] };
	/** GET/PUT /api/budget; default: nothing set */
	budget?: { monthly_budget: number | null; spent: number; categories: { category: string; limit: number; spent: number }[] };
	/** POST /api/budget/draft proposals; default [] */
	draft?: object[];
	currency?: string;
	/** proposal ids whose approve returns 409 (a newer draft replaced them) */
	replaced?: string[];
};

export type ChatFixture = {
	/** existing threads, newest first */
	threads?: { id: string; title: string; updated_at: string; message_count: number; messages?: { role: string; content: string }[] }[];
	/** the answer text POST /chat returns (default "Answer to: <query>") */
	answer?: string;
	/** the "Next:" suggestion POST /chat returns (default none) */
	followUp?: string;
	suggestions?: string[];
	/** hold each POST /chat this long, to test the in-flight state */
	delayMs?: number;
};

export async function signIn(
	page: Page,
	opts: { reviewCount?: number; home?: HomeFixture; chat?: ChatFixture } = {},
): Promise<void> {
	const home = opts.home ?? {};
	// a tiny stateful chat backend: POST /chat creates or extends a thread, the list and messages follow
	const threads = (opts.chat?.threads ?? []).map((t) => ({ ...t, messages: [...(t.messages ?? [])] }));
	let nextThread = 1;
	await page.context().addCookies([{ name: "lumen_session", value: "1", domain: "localhost", path: "/" }]);
	await page.addInitScript(() => {
		const now = Math.floor(Date.now() / 1000);
		localStorage.setItem(
			"sb-127-auth-token",
			JSON.stringify({
				access_token: "e2e",
				refresh_token: "e2e",
				token_type: "bearer",
				expires_in: 3600,
				expires_at: now + 3600,
				user: { id: "e2e-user", email: "e2e@lumen.test", user_metadata: { full_name: "E2E User" } },
			}),
		);
	});
	// a tiny stateful review queue: approving/rejecting removes the item, so the sidebar badge can be checked
	let queue = Array.from({ length: opts.reviewCount ?? 0 }, (_, i) => ({
		id: `r${i}`,
		status: "flagged",
		confidence: "low",
		invoice: { vendor_name: `Vendor ${i}` },
		flags: [],
		transaction_id: null,
		note: null,
		created_at: null,
	}));
	await page.route("http://127.0.0.1:9/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;
		if (home.delayMs) await new Promise((r) => setTimeout(r, home.delayMs));
		if (path === "/transactions") {
			const from = url.searchParams.get("date_from") ?? "0000";
			const to = url.searchParams.get("date_to") ?? "9999";
			const all = (home.txns ?? []).filter((t) => t.date >= from && t.date <= to).sort((a, b) => b.date.localeCompare(a.date));
			// like the real API: at most 100 rows per page
			const size = Math.min(Number(url.searchParams.get("page_size") ?? 10), 100);
			const page = Number(url.searchParams.get("page") ?? 1);
			const data = all.slice((page - 1) * size, page * size);
			return route.fulfill({ json: { success: true, data, pagination: { page, has_next: page * size < all.length, total_items: all.length } } });
		}
		if (path === "/api/analytics/reminders")
			return route.fulfill({ json: { success: true, reminders: home.reminders ?? [], count: 0 } });
		if (path === "/api/analytics/forecast") {
			if (home.forecastDelayMs) await new Promise((r) => setTimeout(r, home.forecastDelayMs));
			if (home.forecast === "fail") return route.fulfill({ status: 500, json: { error: "boom" } });
			const f = home.forecast;
			return route.fulfill({ json: { success: true, forecast: f ? { success: true, forecast: f } : { success: false } } });
		}
		if (path === "/api/review") {
			if (url.searchParams.get("count") === "1") return route.fulfill({ json: { success: true, count: queue.length } });
			return route.fulfill({ json: { items: queue } });
		}
		if (path === "/api/home/summary") {
			const review = queue.length
				? [{ kind: "review", tag: "RECEIPTS", headline: `${queue.length} ${queue.length === 1 ? "receipt needs" : "receipts need"} a glance`,
					detail: "Lumen wasn't sure about these. Nothing is saved until you approve.", amounts: [], worth: null, href: "/receipts?tab=review" }]
				: [];
			const s = home.summary ?? { found: review };
			return route.fulfill({ json: { success: true, more: 0, worth_total: 0, activity: [], ...s } });
		}
		if (path === "/api/budget")
			return route.fulfill({ json: { success: true, month: "", ...(home.budget ?? { monthly_budget: null, spent: 0, categories: [] }) } });
		if (path === "/api/budget/draft") return route.fulfill({ json: { success: true, proposals: home.draft ?? [] } });
		const proposal = path.match(/^\/api\/agent\/proposals\/([^/]+)\/(approve|reject)$/);
		if (proposal && home.replaced?.includes(proposal[1]))
			return route.fulfill({ status: 409, json: { detail: "Proposal is already rejected" } });
		if (proposal) return route.fulfill({ json: { success: true, proposal: { id: proposal[1], status: `${proposal[2]}d` }, applied: null } });
		const decided = path.match(/^\/api\/review\/([^/]+)\/(approve|reject)$/);
		if (decided) {
			const item = queue.find((q) => q.id === decided[1])!;
			queue = queue.filter((q) => q.id !== decided[1]);
			return route.fulfill({ json: { item: { ...item, status: `${decided[2]}d` } } });
		}
		if (path === "/api/agent/proposals") return route.fulfill({ json: { proposals: [] } });
		if (path === "/chat/suggestions") return route.fulfill({ json: { suggestions: opts.chat?.suggestions ?? [] } });
		if (path === "/chat/threads")
			return route.fulfill({
				json: { success: true, threads: threads.map(({ messages, ...t }) => ({ ...t, message_count: messages.length })) },
			});
		const one = path.match(/^\/chat\/threads\/([^/]+)$/);
		if (one) {
			const t = threads.find((x) => x.id === one[1]);
			if (!t) return route.fulfill({ status: 404, json: { error: "not found" } });
			if (route.request().method() === "DELETE") {
				threads.splice(threads.indexOf(t), 1);
				return route.fulfill({ json: { success: true } });
			}
			return route.fulfill({
				json: { success: true, thread: { id: t.id, title: t.title }, messages: t.messages.map((m, i) => ({ id: `${t.id}-${i}`, ...m })) },
			});
		}
		if (path === "/chat" && route.request().method() === "POST") {
			const body = route.request().postDataJSON() as { query: string; thread_id?: string };
			if (opts.chat?.delayMs) await new Promise((r) => setTimeout(r, opts.chat!.delayMs));
			let t = threads.find((x) => x.id === body.thread_id);
			if (!t) {
				t = { id: `t${nextThread++}`, title: body.query.slice(0, 60), updated_at: new Date().toISOString(), message_count: 0, messages: [] };
				threads.unshift(t);
			}
			const response = opts.chat?.answer ?? `Answer to: ${body.query}`;
			t.messages.push({ role: "user", content: body.query }, { role: "assistant", content: response });
			return route.fulfill({
				json: { success: true, data: { response, follow_up: opts.chat?.followUp ?? null, sources: [], steps: [], proposals: [], stopped: "answer", thread_id: t.id } },
			});
		}
		if (path === "/api/profile")
			return route.fulfill({
				json: { profile: { display_name: "E2E User", avatar_key: null, currency: home.currency ?? "INR", onboarded: true, demo: false } },
			});
		return route.fulfill({ json: {} });
	});
	// supabase signOut and any other auth call
	await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 204, body: "" }));
}
