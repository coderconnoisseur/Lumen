import { test, expect } from "@playwright/test";

// What only a real Night build can show. In PowerShell: $env:NEXT_PUBLIC_APP_THEME="night"; npx playwright test e2e/night-build.spec.ts
test.skip(process.env.NEXT_PUBLIC_APP_THEME !== "night", "needs NEXT_PUBLIC_APP_THEME=night");

test("app pages are night from the first server paint", async ({ request }) => {
	const html = await (await request.get("/home", { headers: { cookie: "lumen_session=1" } })).text();
	expect(html).toContain('data-app-theme="night"');
	expect(html).toContain('<meta name="theme-color" content="#0b0b0c"/>');
});
