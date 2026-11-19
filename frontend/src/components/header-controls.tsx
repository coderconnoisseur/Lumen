"use client";

import { useAppTheme } from "@/components/app-theme";
import { AvatarMenu } from "@/components/avatar-menu";
import { Moon } from "@/components/icons";
import { cn } from "@/lib/utils";

// The dark mode switch and the account menu, side by side at the top right. Same 36px height and pill border as the
// page's own buttons (Upload, Export), so the row lines up. PageHeader puts it at the end of its row; pages without one
// (Ask) and phones get it from app-shell.tsx.
export function HeaderControls({ className }: { className?: string }) {
	const { theme, setTheme } = useAppTheme();
	const on = theme === "night";
	return (
		<div data-header-controls className={cn("flex items-center gap-2", className)}>
			<button
				type="button"
				role="switch"
				aria-checked={on}
				aria-label="Dark mode"
				title="Dark mode"
				onClick={() => setTheme(on ? "sky" : "night")}
				className="flex h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-2.5 text-foreground/80 backdrop-blur hover:bg-card hover:text-foreground"
			>
				<Moon className="size-4" />
				<span className={cn("relative h-[18px] w-8 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
					<span className={cn("absolute top-0.5 size-3.5 rounded-full bg-white transition-[left]", on ? "left-[15px]" : "left-0.5")} />
				</span>
			</button>
			<AvatarMenu />
		</div>
	);
}
