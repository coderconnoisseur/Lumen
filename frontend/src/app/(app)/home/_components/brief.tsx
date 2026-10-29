import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// The one- or two-sentence brief, in the serif. Reserved height = two lines, so it never pushes the cards down.
export function Brief({ text }: { text: ReactNode | null }) {
	return (
		<div className="min-h-[55px] max-w-[820px]">
			{text === null ? (
				<Skeleton className="h-[55px] w-full max-w-[620px] bg-white/50" />
			) : (
				<p data-testid="brief" className="font-serif text-[19px] leading-[1.45] text-foreground/80">
					{text}
				</p>
			)}
		</div>
	);
}
