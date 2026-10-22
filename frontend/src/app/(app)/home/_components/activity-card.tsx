import Link from "next/link";
import type { ActivityItem } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { fill, relativeTime } from "@/lib/home-math";
import { HomeCard } from "./card";

// What happened lately: statement imports, receipts read, your decisions (GET /api/home/summary).
export function ActivityCard({ items, now, loading }: { items: ActivityItem[]; now: Date; loading: boolean }) {
	const money = useMoney();
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
				items.map((a, i) => (
					<div key={i} className="flex gap-2 py-1 text-[12.5px]">
						<span className="min-w-0 flex-1 truncate">{fill(a.text, a.amounts, money)}</span>
						<span className="label-ui shrink-0 text-muted-foreground">{relativeTime(a.at, now)}</span>
					</div>
				))
			)}
		</HomeCard>
	);
}
