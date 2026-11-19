import type { ReactNode } from "react";
import type { Viewport } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { parseTheme, THEME_COLOR, THEME_COOKIE } from "@/lib/app-theme";

const theme = () => parseTheme(cookies().get(THEME_COOKIE)?.value);

// Server file so the first paint is already the chosen theme, browser-bar colour included (a client layout can't
// export a viewport or read the cookie).
export function generateViewport(): Viewport {
	const t = theme();
	return { themeColor: THEME_COLOR[t], colorScheme: t === "night" ? "dark" : "light" };
}

export default function AppLayout({ children }: { children: ReactNode }) {
	return <AppShell theme={theme()}>{children}</AppShell>;
}
