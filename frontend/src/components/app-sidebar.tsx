"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarClock, ChartLine, House, Receipt, Sparkles, type LucideIcon } from "lucide-react";

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
	SidebarSeparator,
	useSidebar,
} from "@/components/ui/sidebar";
import { reviewApi } from "@/lib/api/client";
import { eventBus, EVENTS } from "@/lib/events";
import { isTypingTarget } from "@/lib/utils";

type Item = { label: string; url: string; icon: LucideIcon };

// Spec section 3. Group labels say what you do, not what the backend is. Budget and Forecast (PLAN) join once
// their pages exist.
const HOME: Item = { label: "Home", url: "/home", icon: House };
const TRACK: Item[] = [
	{ label: "Spending", url: "/spending", icon: ChartLine },
	{ label: "Bills & subscriptions", url: "/bills", icon: CalendarClock },
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

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
	const router = useRouter();
	const pathname = usePathname();
	const [toReview, setToReview] = React.useState(0);
	const [mac, setMac] = React.useState(false);

	// refreshed on navigation and after each review decision (which happens without leaving /receipts)
	React.useEffect(() => {
		const refresh = () => reviewApi.count().then(setToReview, () => setToReview(0));
		void refresh();
		return eventBus.on(EVENTS.REVIEW_DECIDED, refresh);
	}, [pathname]);

	React.useEffect(() => {
		setMac(/Mac|iPhone|iPad/.test(navigator.platform));
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey) && !isTypingTarget(e.target)) {
				e.preventDefault();
				router.push(ASK.url);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [router]);

	return (
		<Sidebar collapsible="icon" {...props} className="border-r border-sidebar-border/80">
			<SidebarHeader className="px-3 py-4">
				<Link href="/home" className="flex items-center gap-2.5 px-1">
					<Image src="/lumen_logo.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
					<span className="text-[17px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
						Lumen
					</span>
				</Link>
			</SidebarHeader>
			<SidebarContent className="px-1">
				<SidebarGroup>
					<SidebarMenu>
						<NavItem item={HOME} />
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup>
					<SidebarGroupLabel className="label-mono">Track</SidebarGroupLabel>
					<SidebarMenu>
						{TRACK.map((item) => (
							<NavItem key={item.url} item={item} />
						))}
					</SidebarMenu>
				</SidebarGroup>
				<SidebarSeparator className="mx-3" />
				<SidebarGroup>
					<SidebarMenu>
						<NavItem item={RECEIPTS}>
							{toReview > 0 && <SidebarMenuBadge>{toReview}</SidebarMenuBadge>}
						</NavItem>
						<NavItem item={ASK}>
							{/* fixed width: the label swaps to ⌘K on a Mac after mount without moving anything */}
							<kbd className="label-mono pointer-events-none absolute top-1.5 right-1 w-12 rounded border border-sidebar-border py-0.5 text-center text-muted-foreground group-data-[collapsible=icon]:hidden">
								{mac ? "⌘K" : "Ctrl K"}
							</kbd>
						</NavItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarRail />
		</Sidebar>
	);
}
