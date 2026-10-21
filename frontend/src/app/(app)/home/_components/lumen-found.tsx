import Link from "next/link";
import { HomeCard } from "./card";

// "Lumen found": things worth your attention. Phase 2 has one real source (the review queue); Phase 3 adds
// subscriptions, spending spikes and duplicate charges, so the tile grid is already three wide.
export function LumenFound({ toReview, loading }: { toReview: number; loading: boolean }) {
	return (
		<HomeCard title="Lumen found" loading={loading} skeletonHeight={132} data-testid="lumen-found">
			{toReview > 0 ? (
				<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
					<div className="rounded-xl border border-border bg-background p-3">
						<div className="label-mono text-primary">Receipts</div>
						<p className="my-1 font-serif text-[17px] leading-tight">
							{toReview} {toReview === 1 ? "receipt needs" : "receipts need"} a glance
						</p>
						<p className="text-[12.5px] leading-snug text-muted-foreground">
							Lumen wasn&apos;t sure about these. Nothing is saved until you approve.
						</p>
						<Link href="/receipts?tab=review" className="label-mono mt-2 inline-block underline underline-offset-4">
							Review →
						</Link>
					</div>
				</div>
			) : (
				<p className="font-serif text-[17px] text-muted-foreground">Nothing needs you right now.</p>
			)}
		</HomeCard>
	);
}
