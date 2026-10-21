import type { Page } from "@playwright/test";

// Fake a signed-in user without Supabase or the backend. Call before page.goto.
// - supabase-js reads a non-expired session from localStorage without a network call
//   (key = sb-<first label of NEXT_PUBLIC_SUPABASE_URL host>-auth-token; the e2e host is 127.0.0.1).
// - the `lumen_session` cookie gets past middleware.
// - every backend call (NEXT_PUBLIC_BACKEND_URL in playwright.config.ts) is stubbed.
export async function signIn(page: Page, opts: { reviewCount?: number } = {}): Promise<void> {
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
	await page.route("http://127.0.0.1:9/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === "/api/review") return route.fulfill({ json: { items: queue } });
		const decided = path.match(/^\/api\/review\/([^/]+)\/(approve|reject)$/);
		if (decided) {
			const item = queue.find((q) => q.id === decided[1])!;
			queue = queue.filter((q) => q.id !== decided[1]);
			return route.fulfill({ json: { item: { ...item, status: `${decided[2]}d` } } });
		}
		if (path === "/api/agent/proposals") return route.fulfill({ json: { proposals: [] } });
		if (path === "/chat/history") return route.fulfill({ json: { success: true, messages: [] } });
		if (path === "/chat/suggestions") return route.fulfill({ json: { suggestions: [] } });
		if (path === "/api/profile") return route.fulfill({ json: { display_name: "E2E User", avatar_key: null } });
		return route.fulfill({ json: {} });
	});
	// supabase signOut and any other auth call
	await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 204, body: "" }));
}
