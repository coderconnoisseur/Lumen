"use client";

import { Suspense, type ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthGuard } from "@/components/auth/auth-guard";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

// The signed-in app's frame: auth check, sidebar and top bar are built once and stay mounted while you move between
// pages (URLs are unchanged; "(app)" is a route group), so only the content area swaps, like tabs on X.
export default function AppLayout({ children }: { children: ReactNode }) {
	return (
		<Suspense>
			<AuthGuard>
				<SidebarProvider>
					<AppSidebar />
					<SidebarInset id="main" className="min-h-screen bg-transparent">
						<header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-xl">
							<div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
								<SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
								<Separator orientation="vertical" className="h-4" />
								<div className="text-sm font-medium text-muted-foreground">Lumen</div>
							</div>
						</header>
						{children}
					</SidebarInset>
				</SidebarProvider>
			</AuthGuard>
		</Suspense>
	);
}
