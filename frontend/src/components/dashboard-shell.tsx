"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// A page's content area and optional header card. The sidebar and top bar live in app/(app)/layout.tsx and stay
// mounted across pages.

interface DashboardShellProps {
	/** omit for full-bleed pages (e.g. chat) that draw their own header */
	title?: string;
	description?: string;
	children: ReactNode;
	actions?: ReactNode;
	toolbar?: ReactNode;
	eyebrow?: string;
	contentClassName?: string;
}

export function DashboardShell({
	title,
	description,
	children,
	actions,
	toolbar,
	eyebrow = "Finance Workspace",
	contentClassName,
}: DashboardShellProps) {
	return (
		<div
			className={cn(
				"flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8",
				contentClassName
			)}
		>
			{title && (<section className="rounded-3xl border border-border/70 bg-card/70 px-5 py-5 shadow-sm shadow-black/10 sm:px-6">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div className="space-y-3">
						<Badge
							variant="outline"
							className="w-fit rounded-full border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase text-primary"
						>
							{eyebrow}
						</Badge>
						<div className="space-y-2">
							<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
								{title}
							</h1>
							<p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
								{description}
							</p>
						</div>
					</div>
					{actions && (
						<div className="flex flex-wrap items-center gap-3">
							{actions}
						</div>
					)}
				</div>
				{toolbar && (
					<div className="mt-5 border-t border-border/70 pt-5">
						{toolbar}
					</div>
				)}
			</section>)}
			{children}
		</div>
	);
}
