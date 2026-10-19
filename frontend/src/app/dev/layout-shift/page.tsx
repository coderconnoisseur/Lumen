"use client";

import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// Dev-only harness for e2e/foundations.spec.ts: one of each overlay above a scrolling, centred column, inside the
// app theme scope. Lets us prove overlays never move the page without needing a signed-in session.
export default function LayoutShiftHarness() {
	if (process.env.NODE_ENV === "production") notFound();

	return (
		<div data-app-theme="sky">
			<main data-testid="probe" className="mx-auto max-w-2xl space-y-4 p-6">
				<div className="flex flex-wrap gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button data-testid="open-dropdown">Dropdown</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem>Item</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Dialog>
						<DialogTrigger asChild>
							<Button data-testid="open-dialog">Dialog</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogTitle>Dialog</DialogTitle>
						</DialogContent>
					</Dialog>
					<Select>
						<SelectTrigger data-testid="open-select">
							<SelectValue placeholder="Select" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="a">A</SelectItem>
						</SelectContent>
					</Select>
					<Popover>
						<PopoverTrigger asChild>
							<Button data-testid="open-popover">Popover</Button>
						</PopoverTrigger>
						<PopoverContent>Popover</PopoverContent>
					</Popover>
					<Sheet>
						<SheetTrigger asChild>
							<Button data-testid="open-sheet">Sheet</Button>
						</SheetTrigger>
						<SheetContent>
							<SheetTitle>Sheet</SheetTitle>
						</SheetContent>
					</Sheet>
				</div>
				<div data-testid="transition-probe" style={{ transition: "opacity 200ms" }} />
				{Array.from({ length: 60 }, (_, i) => (
					<p key={i} className="text-muted-foreground">
						Filler paragraph {i + 1} so the page scrolls and has a scrollbar to lose.
					</p>
				))}
			</main>
		</div>
	);
}
