import { vendorChip } from "@/lib/home-math";
import { cn } from "@/lib/utils";

// A vendor's initials on a soft tint of its own stable hue (lib/home-math vendorChip).
export function VendorChip({ name, className }: { name: string; className?: string }) {
	const { initials, hue } = vendorChip(name);
	return (
		<span
			aria-hidden
			className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold", className)}
			style={{ background: `hsl(${hue} 70% 94%)`, color: `hsl(${hue} 45% 38%)` }}
		>
			{initials}
		</span>
	);
}
