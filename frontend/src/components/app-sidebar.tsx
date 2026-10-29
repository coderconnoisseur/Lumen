"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, ChartLine, House, PieChart, Receipt, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";

import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { reviewApi } from "@/lib/api/client";
import { eventBus, EVENTS } from "@/lib/events";

type Item = { label: string; url: string; icon: LucideIcon };

// Spec section 3. Every group is labelled (owner, 2026-10-22); labels say what you do, not what the backend is.
const HOME: Item = { label: "Home", url: "/home", icon: House };
const TRACK: Item[] = [
	{ label: "Spending", url: "/spending", icon: ChartLine },
	{ label: "Bills & subscriptions", url: "/bills", icon: CalendarClock },
];
const PLAN: Item[] = [
	{ label: "Budget", url: "/budget", icon: PieChart },
	{ label: "Forecast", url: "/forecast", icon: TrendingUp },
];
const RECEIPTS: Item = { label: "Receipts & statements", url: "/receipts", icon: Receipt };
const ASK: Item = { label: "Ask Lumen", url: "/ask", icon: Sparkles };

function NavItem({ item, children }: { item: Item; children?: React.ReactNode }) {
	const pathname = usePathname();
	const { isMobile, setOpenMobile } = useSidebar();
	const active = pathname === item.url || pathname.startsWith(`${item.url}/`);
	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild tooltip={item.label} isActive={active}>
				{/* on phones the sidebar is a sheet over the page: close it once you've picked somewhere */}
				<Link href={item.url} onClick={() => isMobile && setOpenMobile(false)}>
					<item.icon />
					<span>{item.label}</span>
				</Link>
			</SidebarMenuButton>
			{children}
		</SidebarMenuItem>
	);
}

// `onAsk` opens the Ask palette, which app-shell.tsx owns: below md this sidebar is a Sheet that isn't mounted while
// closed, so a palette (and its Ctrl+K) living in here would do nothing there.
export function AppSidebar({ onAsk, ...props }: React.ComponentProps<typeof Sidebar> & { onAsk: () => void }) {
	const pathname = usePathname();
	const [toReview, setToReview] = React.useState(0);
	const [mac, setMac] = React.useState(false);

	// refreshed on navigation and after each review decision (which happens without leaving /receipts)
	React.useEffect(() => {
		const refresh = () => reviewApi.count().then(setToReview, () => setToReview(0));
		void refresh();
		return eventBus.on(EVENTS.REVIEW_DECIDED, refresh);
	}, [pathname]);

	React.useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

	return (
		<Sidebar collapsible="icon" {...props} className="border-r border-sidebar-border/80">
			{/* the collapse control lives here, not in a top bar (owner, 2026-10-22). On the icon rail the logo turns into
			    the expand button on hover, so the rail stays 56px wide. */}
			<SidebarHeader className="group/head px-3 py-4">
				<div className="flex items-center gap-2.5 px-1">
					<Link
						href="/home"
						aria-label="Lumen home"
						className="flex items-center gap-2.5 group-data-[collapsible=icon]:group-hover/head:hidden"
					>
						<Image src="/lumen_logo.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
						<span className="text-[17px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
							Lumen
						</span>
					</Link>
					<SidebarTrigger
						aria-label="Toggle sidebar (Ctrl+B)"
						className="ml-auto hidden text-muted-foreground hover:text-foreground md:inline-flex group-data-[collapsible=icon]:-ml-0.5 group-data-[collapsible=icon]:hidden group-data-[collapsible=icon]:group-hover/head:inline-flex"
					/>
				</div>
			</SidebarHeader>
			<SidebarContent className="px-1">
				<SidebarGroup>
					<SidebarGroupLabel className="label-ui">Overview</SidebarGroupLabel>
					<SidebarMenu>
						<NavItem item={HOME} />
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel className="label-ui">Track</SidebarGroupLabel>
					<SidebarMenu>
						{TRACK.map((item) => (
							<NavItem key={item.url} item={item} />
						))}
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel className="label-ui">Plan</SidebarGroupLabel>
					<SidebarMenu>
						{PLAN.map((item) => (
							<NavItem key={item.url} item={item} />
						))}
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel className="label-ui">Records</SidebarGroupLabel>
					<SidebarMenu>
						<NavItem item={RECEIPTS}>
							{toReview > 0 && <SidebarMenuBadge>{toReview}</SidebarMenuBadge>}
						</NavItem>
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel className="label-ui">Assistant</SidebarGroupLabel>
					<SidebarMenu>
						<NavItem item={ASK} />
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup className="mt-auto">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip={`Ask anything (${mac ? "⌘K" : "Ctrl K"})`}
								onClick={onAsk}
								className="border border-sidebar-border bg-card text-muted-foreground hover:text-foreground"
							>
								<Sparkles />
								<span>Ask anything</span>
							</SidebarMenuButton>
							{/* fixed width: the label swaps to ⌘K on a Mac after mount without moving anything */}
							<kbd className="label-ui pointer-events-none absolute top-1.5 right-1.5 w-12 rounded border border-sidebar-border py-0.5 text-center text-muted-foreground group-data-[collapsible=icon]:hidden">
								{mac ? "⌘K" : "Ctrl K"}
							</kbd>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarRail />
		</Sidebar>
	);
}
