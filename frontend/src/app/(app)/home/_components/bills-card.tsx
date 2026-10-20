import { useMoney } from "@/lib/format";
import { parseDay } from "@/lib/home-math";
import type { Reminder } from "../use-home-data";
import { HomeCard } from "./card";

// The next three recurring charges Lumen expects.
export function BillsCard({ reminders, today, loading }: { reminders: Reminder[]; today: Date; loading: boolean }) {
	const money = useMoney();
	const next = reminders
		.filter((r) => r.type === "upcoming" && parseDay(r.date) >= today)
		.sort((a, b) => a.date.localeCompare(b.date))
		.slice(0, 3);
	return (
		<HomeCard title="Upcoming bills" href="/bills" loading={loading} skeletonHeight={138}>
			{next.length === 0 ? (
				<p className="text-sm text-muted-foreground">No bills coming up in the next month.</p>
			) : (
				next.map((r) => {
					const d = parseDay(r.date);
					return (
						<div key={r.id} data-testid="bill-row" className="flex items-center gap-2.5 py-1.5 text-[13px]">
							<span className="label-mono w-9 shrink-0 rounded-md border border-border py-0.5 text-center text-muted-foreground">
								{d.toLocaleString("en-GB", { weekday: "short" })}
								<b className="block text-[13px] text-foreground">{String(d.getDate()).padStart(2, "0")}</b>
							</span>
							<span className="min-w-0 flex-1 truncate">{r.vendor}</span>
							<span className="shrink-0 tabular-nums">{r.amount == null ? "—" : money(r.amount)}</span>
						</div>
					);
				})
			)}
		</HomeCard>
	);
}
