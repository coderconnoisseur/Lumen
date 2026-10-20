import Link from "next/link";
import { useMoney } from "@/lib/format";
import { relativeTime, type Txn } from "@/lib/home-math";
import { HomeCard } from "./card";

// Interim activity feed: the newest imports by when they arrived (Phase 3 may replace it with a real feed).
export function ActivityCard({ txns, now, loading }: { txns: Txn[]; now: Date; loading: boolean }) {
	const money = useMoney();
	const items = txns
		.filter((t) => t.created_at)
		.sort((a, b) => b.created_at!.localeCompare(a.created_at!))
		.slice(0, 5);
	return (
		<HomeCard title="Activity" loading={loading} skeletonHeight={110} data-testid="activity">
			{items.length === 0 ? (
				<p className="text-[12.5px] text-muted-foreground">
					Nothing imported yet.{" "}
					<Link href="/receipts?tab=import" className="underline underline-offset-4">
						Upload a receipt or a statement
					</Link>{" "}
					to get started.
				</p>
			) : (
				items.map((t) => (
					<div key={t.id} className="flex gap-2 py-1 text-[12.5px]">
						<span className="min-w-0 flex-1 truncate">
							Added {t.vendor_name ?? "a transaction"} {money(t.total_amount ?? 0)}
						</span>
						<span className="label-mono shrink-0 text-muted-foreground">{relativeTime(t.created_at!, now)}</span>
					</div>
				))
			)}
		</HomeCard>
	);
}
