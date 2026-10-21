import { defineConfig, devices } from "@playwright/test";

// Local-only UI checks (not wired into CI). Dummy public env lets the root providers construct without a backend.
export default defineConfig({
	testDir: "e2e",
	use: { baseURL: "http://localhost:3100" },
	projects: [
		// Headless Chromium hides scrollbars by default, which hides the very scrollbar-width shifts we test for.
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } },
		},
		// Opt-in: on the owner's Windows machine the Playwright Firefox build is blocked from executing.
		...(process.env.E2E_FIREFOX ? [{ name: "firefox", use: devices["Desktop Firefox"] }] : []),
	],
	webServer: {
		command: "npx next dev -p 3100",
		url: "http://localhost:3100/dev/layout-shift",
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
			NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-dummy",
			NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:9",
		},
	},
});
