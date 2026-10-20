import type { ReactNode } from "react";
import type { Viewport } from "next";
import { AppShell } from "@/components/app-shell";

// Server file only so the light app can set its own browser-bar colour (a client layout can't export `viewport`).
export const viewport: Viewport = { themeColor: "#f4f3ef", colorScheme: "light" };

export default function AppLayout({ children }: { children: ReactNode }) {
	return <AppShell>{children}</AppShell>;
}
