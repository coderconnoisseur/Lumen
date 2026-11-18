/** @type {import('next').NextConfig} */

// Fail fast if a required public env var is missing. This runs at build time
// (next build) and at dev-server start (next dev), so a missing var blocks
// both rather than silently shipping with `undefined` baked into the bundle.
const requiredPublic = [
	"NEXT_PUBLIC_BACKEND_URL",
	"NEXT_PUBLIC_SUPABASE_URL",
	"NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

const missing = requiredPublic.filter((name) => !process.env[name]);
if (missing.length > 0) {
	throw new Error(
		`Missing required environment variable(s): ${missing.join(", ")}. ` +
			`Copy frontend/.env.example to frontend/.env.local and fill in the values.`
	);
}

const nextConfig = {
	reactStrictMode: true,
	// e2e runs its own dev server (playwright.config.ts) with dummy env; a separate build folder keeps it from
	// clobbering the `npm run dev` server's cache in the same checkout ("missing required error components").
	distDir: process.env.NEXT_DIST_DIR || ".next",
	// The login page used to live at /signin; old bookmarks and already-sent email links still work
	// (query strings carry over, and browsers keep the #fragment Supabase puts on email links).
	async redirects() {
		// UI revamp Phase 1 renamed the app pages; temporary (307) while names may still change before launch.
		const moved = [
			["/dashboard", "/home"],
			["/analytics", "/spending"],
			["/ai-analytics", "/spending"],
			["/chatbot", "/ask"],
			["/documents", "/receipts"],
			["/import", "/receipts/import"],
			["/review", "/receipts"],
			["/upload", "/home?upload=1"],
		].map(([source, destination]) => ({ source, destination, permanent: false }));
		return [{ source: "/signin", destination: "/login", permanent: true }, ...moved];
	},
};

module.exports = nextConfig;
