import type { Page } from "@playwright/test";

// Fake a signed-in user without Supabase or the backend. Call before page.goto.
// - supabase-js reads a non-expired session from localStorage without a network call
//   (key = sb-<first label of NEXT_PUBLIC_SUPABASE_URL host>-auth-token; the e2e host is 127.0.0.1).
// - the `lumen_session` cookie gets past middleware.
// - every backend call (NEXT_PUBLIC_BACKEND_URL in playwright.config.ts) is stubbed.
export type HomeFixture = {
	txns?: { id: string; vendor_name: string; date: string; total_amount: number; category: string | null; created_at: string | null; source?: string | null; invoice_number?: string | null }[];
	reminders?: { id: string; vendor: string; amount: number; date: string; type: string; category?: string }[];
	/** GET /api/bills/recurring items as the API sends them; default: built from `reminders` (monthly, active) */
	recurring?: Record<string, unknown>[];
	/** GET /api/forecast's `forecast` (see `forecastFixture`), "fail" for a 500, null for too little history */
	forecast?: Record<string, unknown> | "fail" | null;
	delayMs?: number;
	forecastDelayMs?: number;
	/** GET /api/home/summary; default: just the review item when reviewCount > 0 */
	summary?: { found: object[]; more?: number; worth_total?: number; activity?: object[] };
	/** GET/PUT /api/budget; default: nothing set */
	budget?: { monthly_budget: number | null; spent: number; categories: { category: string; limit: number; spent: number }[] };
	/** GET /api/budget?month=YYYY-MM for other months, keyed by month; default: the current `budget` */
	budgetMonths?: Record<string, { monthly_budget: number | null; spent: number; categories: { category: string; limit: number; spent: number }[] }>;
	/** GET /api/budget/history months, oldest first; default [] */
	history?: { month: string; budget: number | null; spent: number }[];
	/** POST /api/budget/draft proposals; default [] */
	draft?: object[];
	/** GET /api/agent/proposals (pending); default [] */
	proposals?: object[];
	currency?: string;
	/** proposal ids whose approve returns 409 (a newer draft replaced them) */
	replaced?: string[];
	/** the flagged review queue as GET /api/review sends it; default: `reviewCount` plain items */
	review?: Record<string, unknown>[];
	/** GET /api/documents; default [] (DELETE removes, POST adds) */
	documents?: Record<string, unknown>[];
	/** GET /api/review answers 500 */
	reviewFails?: boolean;
	/** GET /api/statements/imports; default [] */
	imports?: Record<string, unknown>[];
	/** GET /api/v1/email-config/status; default not configured */
	email?: Record<string, unknown>;
};

export type ChatFixture = {
	/** existing threads, newest first */
	threads?: { id: string; title: string; updated_at: string; message_count: number; messages?: { role: string; content: string }[] }[];
	/** the answer text POST /chat returns (default "Answer to: <query>") */
	answer?: string;
	/** the "Next:" suggestion POST /chat returns (default none) */
	followUp?: string;
	/** the agent's steps POST /chat returns (default none) */
	steps?: { tool: string; args: object; summary: string }[];
	suggestions?: string[];
	/** hold each POST /chat this long (or per question), to test the in-flight state */
	delayMs?: number | ((query: string) => number);
};

export async function signIn(
	page: Page,
	opts: { reviewCount?: number; home?: HomeFixture; chat?: ChatFixture } = {},
): Promise<void> {
	// a copy: routes like the transactions PUT change it, and tests share their fixture objects
	const home: HomeFixture = structuredClone(opts.home ?? {});
	const billStates = new Map<string, string>(); // vendor (lower case) → cancelled | not_a_bill | active
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
	const generated = Array.from({ length: opts.reviewCount ?? 0 }, (_, i) => ({
		id: `r${i}`,
		status: "flagged",
		confidence: "low",
		invoice: { vendor_name: `Vendor ${i}` } as Record<string, unknown>,
		flags: [] as unknown[],
		transaction_id: null,
		note: null,
		created_at: null as string | null,
	}));
	let queue = (home.review as typeof generated | undefined) ?? generated;
	const documents = [...(home.documents ?? [])];
	await page.route("http://127.0.0.1:9/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;
		if (home.delayMs) await new Promise((r) => setTimeout(r, home.delayMs));
		const method = route.request().method();
		if (path === "/api/documents" && method === "GET") return route.fulfill({ json: { success: true, documents } });
		if (path === "/api/documents" && method === "POST") {
			const doc = { id: `d${documents.length + 1}`, title: "New document", doc_type: "other", filename: "new.pdf", chunk_count: 3, created_at: new Date().toISOString() };
			documents.unshift(doc);
			return route.fulfill({ json: { success: true, document: doc } });
		}
		const doc = path.match(/^\/api\/documents\/([^/]+)$/);
		if (doc && method === "DELETE") {
			documents.splice(documents.findIndex((d) => d.id === doc[1]), 1);
			return route.fulfill({ json: { success: true } });
		}
		if (path === "/api/review" && home.reviewFails && !url.searchParams.get("count")) return route.fulfill({ status: 500, json: { success: false, error: "boom" } });
		if (path === "/api/statements/preview")
			return route.fulfill({ json: { success: true, columns: ["Date", "Description", "Amount"], mapping: { date: 0, description: 1, debit: null, credit: null, amount: 2, drcr: null },
				header_line: 1, sample: [{ line: 2, date: "2026-10-01", description: "X", amount: 5, kind: "debit" }], counts: { rows: 1, debits: 1, credits: 0, unreadable: 0 } } });
		if (path.startsWith("/api/files/")) return route.fulfill({ body: "original", contentType: "image/png" });
		if (path === "/api/statements/imports") return route.fulfill({ json: { success: true, imports: home.imports ?? [] } });
		if (path === "/api/v1/email-config/status") return route.fulfill({ json: home.email ?? { configured: false } });
		if (path.startsWith("/api/v1/email-config/")) return route.fulfill({ json: { success: true } });
		// recurring charges (api/bills.py): the fixture's items, or simple monthly ones built from `reminders`; state
		// changes are kept, like the real table
		if (path === "/api/bills/recurring" || path === "/api/bills/recurring/state") {
			if (route.request().method() === "POST") {
				const { vendor, state } = route.request().postDataJSON() as { vendor: string; state: string };
				billStates.set(vendor.toLowerCase(), state);
			}
			const all = (home.recurring ?? (home.reminders ?? []).filter((r) => r.vendor).map((r) => ({
				vendor: r.vendor, category: r.category ?? null, cadence: "monthly", typical_amount: r.amount,
				last_charge_date: r.date, next_due_date: r.date, charges_count: 3, price_change: null, kind: "subscription",
				possibly_stopped: false, state: "active",
			}))) as { vendor: string; state: string }[];
			const items = all
				.map((i) => ({ ...i, state: billStates.get(i.vendor.toLowerCase()) ?? i.state }))
				.filter((i) => i.state !== "not_a_bill");
			const hidden = all.filter((i) => billStates.get(i.vendor.toLowerCase()) === "not_a_bill").map((i) => ({ vendor: i.vendor, vendor_key: i.vendor.toLowerCase() }));
			return route.fulfill({ json: { success: true, items, hidden } });
		}
		// category edits from Spending's table (stateful, like the real PUT)
		const edit = path.match(/^\/transactions\/([^/]+)$/);
		if (edit && route.request().method() === "PUT") {
			const row = (home.txns ?? []).find((t) => String(t.id) === edit[1]);
			if (!row) return route.fulfill({ status: 404, json: { success: false } });
			Object.assign(row, route.request().postDataJSON());
			return route.fulfill({ json: { success: true, data: row } });
		}
		if (path === "/transactions") {
			const from = url.searchParams.get("date_from") ?? "0000";
			const to = url.searchParams.get("date_to") ?? "9999";
			const skip = url.searchParams.get("exclude_source");
			const all = (home.txns ?? []).filter((t) => t.date >= from && t.date <= to && (!skip || t.source !== skip)).sort((a, b) => b.date.localeCompare(a.date));
			// like the real API: at most 100 rows per page
			const size = Math.min(Number(url.searchParams.get("page_size") ?? 10), 100);
			const page = Number(url.searchParams.get("page") ?? 1);
			const data = all.slice((page - 1) * size, page * size);
			return route.fulfill({ json: { success: true, data, pagination: { page, has_next: page * size < all.length, total_items: all.length } } });
		}
		if (path === "/api/forecast") {
			if (home.forecastDelayMs) await new Promise((r) => setTimeout(r, home.forecastDelayMs));
			if (home.forecast === "fail") return route.fulfill({ status: 500, json: { error: "boom" } });
			return route.fulfill({ json: { success: true, forecast: home.forecast ?? null } });
		}
		if (path === "/api/review") {
			if (url.searchParams.get("count") === "1") return route.fulfill({ json: { success: true, count: queue.length } });
			return route.fulfill({ json: { items: queue } });
		}
		if (path === "/api/home/summary") {
			const review = queue.length
				? [{ kind: "review", tag: "RECEIPTS", headline: `${queue.length} ${queue.length === 1 ? "receipt needs" : "receipts need"} a glance`,
					detail: "Lumen wasn't sure about these. Nothing is saved until you approve.", amounts: [], worth: null, href: "/receipts" }]
				: [];
			const s = home.summary ?? { found: review };
			return route.fulfill({ json: { success: true, more: 0, worth_total: 0, activity: [], ...s } });
		}
		if (path === "/api/budget") {
			const none = { monthly_budget: null, spent: 0, categories: [] };
			// PUT is stateful like the real one: a null limit removes the category
			if (route.request().method() === "PUT") {
				const body = route.request().postDataJSON() as { monthly_budget?: number | null; categories?: { category: string; limit: number | null }[] };
				const b = (home.budget = structuredClone(home.budget ?? none));
				if ("monthly_budget" in body) b.monthly_budget = body.monthly_budget ?? null;
				for (const c of body.categories ?? []) {
					const row = b.categories.find((x) => x.category.toLowerCase() === c.category.toLowerCase());
					if (c.limit === null) b.categories = b.categories.filter((x) => x !== row);
					else if (row) row.limit = c.limit;
					else b.categories.push({ category: c.category, limit: c.limit, spent: 0 });
				}
			}
			const month = url.searchParams.get("month");
			const state = (month && home.budgetMonths?.[month]) || home.budget || none;
			return route.fulfill({ json: { success: true, month: month ?? "", ...state } });
		}
		if (path === "/api/budget/history") return route.fulfill({ json: { success: true, months: home.history ?? [] } });
		if (path === "/api/budget/draft") return route.fulfill({ json: { success: true, proposals: home.draft ?? [] } });
		const proposal = path.match(/^\/api\/agent\/proposals\/([^/]+)\/(approve|reject)$/);
		if (proposal && home.replaced?.includes(proposal[1]))
			return route.fulfill({ status: 409, json: { detail: "Proposal is already rejected" } });
		if (proposal) return route.fulfill({ json: { success: true, proposal: { id: proposal[1], status: `${proposal[2]}d` }, applied: null } });
		const decided = path.match(/^\/api\/review\/([^/]+)\/(approve|reject)$/);
		if (decided && home.replaced?.includes(decided[1]))
			return route.fulfill({ status: 409, json: { success: false, error: "This invoice is already recorded", code: "conflict" } });
		if (decided) {
			const item = queue.find((q) => q.id === decided[1])!;
			queue = queue.filter((q) => q.id !== decided[1]);
			return route.fulfill({ json: { item: { ...item, status: `${decided[2]}d` } } });
		}
		if (path === "/api/agent/proposals") return route.fulfill({ json: { proposals: home.proposals ?? [] } });
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
			const delay = typeof opts.chat?.delayMs === "function" ? opts.chat.delayMs(body.query) : opts.chat?.delayMs;
			if (delay) await new Promise((r) => setTimeout(r, delay));
			let t = threads.find((x) => x.id === body.thread_id);
			if (!t) {
				t = { id: `t${nextThread++}`, title: body.query.slice(0, 60), updated_at: new Date().toISOString(), message_count: 0, messages: [] };
				threads.unshift(t);
			}
			const response = opts.chat?.answer ?? `Answer to: ${body.query}`;
			t.messages.push({ role: "user", content: body.query }, { role: "assistant", content: response });
			return route.fulfill({
				json: { success: true, data: { response, follow_up: opts.chat?.followUp ?? null, sources: [], steps: opts.chat?.steps ?? [], proposals: [], stopped: "answer", thread_id: t.id } },
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

/** A GET /api/forecast payload for the current month (Forecast F2): `spent` so far, then `perDay` every day left. */
export function forecastFixture({ spent, perDay, month, budget = null, income = null }: { spent: number; perDay: number; month?: string; budget?: number | null; income?: number | null }) {
	const now = new Date();
	const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	const left = days - now.getDate();
	const path = Array.from({ length: left + 1 }, (_, i) => spent + perDay * i);
	const total = path[path.length - 1];
	const ym = (n: number) => {
		const d = new Date(now.getFullYear(), now.getMonth() + n, 1);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
	};
	const m = (n: number, forecast: number) => ({
		month: n === 0 && month ? month : ym(n), forecast, low: forecast * 0.9, high: forecast * 1.1, bills: 0, everyday: forecast,
		budget, income, left: income ? income - forecast : null, over_budget: budget ? forecast > budget : null, why: "Your usual month.", categories: [],
	});
	return {
		months: [m(0, total), m(1, perDay * 30), m(2, perDay * 30), m(3, perDay * 30)],
		current: { spent_so_far: spent, bills_still_due: { count: 0, amount: 0 }, everyday_rest: total - spent, days_left: left },
		daily: { actual: [spent], path, low: total * 0.9, high: total * 1.1 },
		method: "bills_everyday",
		accuracy: { method: "bills_everyday", label: "Bills + everyday", median_error_pct: 12.8, in_range_pct: 83.3, months_tested: 6, tried: [] },
		items: [],
	};
}

