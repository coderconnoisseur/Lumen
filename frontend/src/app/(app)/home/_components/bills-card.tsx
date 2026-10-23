import { dateTag } from "@/lib/bills-math";
import { useMoney } from "@/lib/format";
import { parseDay } from "@/lib/home-math";
import type { Reminder } from "../use-home-data";
import { PageCard } from "@/components/page/page-card";

// "Coming up": the next four recurring charges Lumen expects, each with a little date chip.
export function BillsCard({ reminders, today, loading }: { reminders: Reminder[]; today: Date; loading: boolean }) {
	const money = useMoney();
	const next = reminders
		.filter((r) => r.type === "late" || (r.type === "upcoming" && parseDay(r.date) >= today))
		.sort((a, b) => a.date.localeCompare(b.date))
		.slice(0, 4);
	return (
		<PageCard title="Coming up" href="/bills" loading={loading} skeletonHeight={227} data-testid="bills-card">
			{next.length === 0 ? (
				<p className="text-sm text-muted-foreground">No bills coming up in the next month.</p>
			) : (
				next.map((r) => {
					const d = parseDay(r.date);
					return (
						<div key={r.id} data-testid="bill-row" className="flex items-center gap-3 border-b border-border/60 py-2 text-[13.5px] last:border-0">
							<span data-testid="date-chip" className="w-[38px] shrink-0 rounded-[9px] border border-border py-1 text-center leading-tight">
								<span className="block text-[10px] text-muted-foreground uppercase">{r.type === "late" ? "Late" : dateTag(d, today)}</span>
								<b className="block text-[14px] font-medium">{d.getDate()}</b>
							</span>
							<span className="min-w-0 flex-1 truncate">{r.vendor}</span>
							<span className="shrink-0 font-medium tabular-nums">{r.amount == null ? "—" : money(r.amount)}</span>
						</div>
					);
				})
			)}
		</PageCard>
	);
}
