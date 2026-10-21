"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { AppSidebar } from "@/components/app-sidebar";
import { AskPalette } from "@/components/ask-palette";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ProfileProvider } from "@/components/profile/profile-provider";
import { AvatarMenu } from "@/components/avatar-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { isTypingTarget } from "@/lib/utils";

// The signed-in app's frame: auth check, sidebar and top bar are built once and stay mounted while you move between
// pages, so only the content area swaps, like tabs on X. Rendered by app/(app)/layout.tsx.
export function AppShell({ children }: { children: ReactNode }) {
	// the Ask palette lives here, not in the sidebar: below md the sidebar is a Sheet that isn't mounted while closed
	const [paletteOpen, setPaletteOpen] = useState(false);
	useEffect(() => {
		// e.code, not e.key: Caps Lock or Shift turns the key into "K"
		const onKey = (e: KeyboardEvent) => {
			if (e.code === "KeyK" && (e.metaKey || e.ctrlKey) && !isTypingTarget(e.target)) {
				e.preventDefault();
				setPaletteOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		// Sky (globals.css) wraps everything, auth loader included, so the first server paint is already light.
		<div data-app-theme="sky" className="contents">
		<Suspense>
			<AuthGuard>
				<ProfileProvider>
				<MotionConfig reducedMotion="user">
				{/* Only ever rendered client-side (the auth guard shows a loader on the server), so reading the remembered
				    state straight from the cookie gives the right width on the sidebar's first paint: no jump, no SSR read. */}
				<SidebarProvider defaultOpen={typeof document === "undefined" || !document.cookie.includes("sidebar_state=false")}>
					<AppSidebar onAsk={() => setPaletteOpen(true)} />
					<AskPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
					<SidebarInset id="main" className="relative min-h-screen bg-transparent">
						{/* no top bar on desktop: just the account menu, floating top-right over the page (owner, 2026-10-22).
						    Phones keep a slim row, since the sidebar there is a sheet that needs a button to open. */}
						<header className="flex h-14 items-center px-4 md:hidden">
							<SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
							<div className="ml-auto">
								<AvatarMenu />
							</div>
						</header>
						<div className="absolute top-5 right-6 z-20 hidden md:block lg:right-8">
							<AvatarMenu />
						</div>
						{children}
					</SidebarInset>
				</SidebarProvider>
				</MotionConfig>
				</ProfileProvider>
			</AuthGuard>
		</Suspense>
		</div>
	);
}
