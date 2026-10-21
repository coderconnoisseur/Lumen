import { Skeleton } from "@/components/ui/skeleton";

// The one- or two-sentence brief, in the serif. Reserved height = two lines, so it never pushes the cards down.
export function Brief({ text }: { text: string | null }) {
	return (
		<div className="mb-4 min-h-[59px] max-w-[820px]">
			{text === null ? (
				<Skeleton className="h-[59px] w-full max-w-[620px] bg-white/50" />
			) : (
				<p data-testid="brief" className="font-serif text-[21px] leading-[1.4] text-foreground">
					{text}
				</p>
			)}
		</div>
	);
}
