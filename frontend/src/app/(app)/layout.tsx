import type { ReactNode } from "react";
import type { Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { APP_THEME } from "@/lib/app-theme";

// Server file only so the app can set its own browser-bar colour (a client layout can't export `viewport`).
export const viewport: Viewport =
	APP_THEME === "night" ? { themeColor: "#0b0b0c", colorScheme: "dark" } : { themeColor: "#f4f3ef", colorScheme: "light" };

export default function AppLayout({ children }: { children: ReactNode }) {
	return <AppShell>{children}</AppShell>;
}
