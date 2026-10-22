import { useMoney } from "@/lib/format";
import { calendarBuckets, heat, parseDay, type Period, type Txn } from "@/lib/home-math";
import { HomeCard } from "./card";

// "₹2.2k" in the user's own currency: take the symbol from how useMoney prints zero
const kShort = (n: number, symbol: string) => (n >= 1000 ? `${symbol}${(n / 1000).toFixed(1)}k` : `${symbol}${Math.round(n)}`);
const dayMonth = (s: string) => parseDay(s).toLocaleString("en-GB", { day: "numeric", month: "short" });

// This month as a heat grid (darker = more spent) beside the latest transactions.
export function CalendarCard({ txns, period, loading }: { txns: Txn[]; period: Period; loading: boolean }) {
	const money = useMoney();
	const symbol = money(0).replace(/[\d.,\s]/g, "");
	const days = calendarBuckets(txns, period);
	const max = Math.max(...days.map((d) => d.amount), 0);
	const lead = (period.start.getDay() + 6) % 7; // Monday first
	const recent = [...txns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

	return (
		<HomeCard title="Spending calendar" loading={loading} skeletonHeight={232}>
			<div className="grid gap-4 md:grid-cols-[1.05fr_1fr]">
				<div className="grid grid-cols-7 gap-1">
					{Array.from({ length: lead }, (_, i) => (
						<div key={`b${i}`} />
					))}
					{days.map(({ day, amount }) => {
						const h = heat(amount, max);
						return (
							<div
								key={day}
								data-testid={`cal-day-${day}`}
								className="h-[34px] overflow-hidden rounded-md border border-border px-1 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground"
								style={h ? { background: `color-mix(in srgb, var(--primary) ${Math.round(h * 100)}%, transparent)`, color: h > 0.5 ? "#fff" : undefined } : undefined}
							>
								{day}
								{amount > 0 && <b className="block font-medium text-inherit">{kShort(amount, symbol)}</b>}
							</div>
						);
					})}
				</div>
				<div className="min-w-0">
					<div className="label-ui mb-1 text-muted-foreground">Recent transactions</div>
					{recent.length === 0 ? (
						<p className="text-sm text-muted-foreground">No transactions this month yet.</p>
					) : (
						recent.map((t) => (
							<div key={t.id} data-testid="recent-row" className="flex items-center gap-3 border-b border-border py-1.5 text-[13px] last:border-0">
								<span className="min-w-0 flex-1">
									<span className="block truncate">{t.vendor_name ?? "Unknown"}</span>
									<span className="block truncate text-[11.5px] text-muted-foreground">
										{t.category ?? "Uncategorised"} · {dayMonth(t.date)}
									</span>
								</span>
								<span className="shrink-0 tabular-nums">{money(t.total_amount ?? 0)}</span>
							</div>
						))
					)}
				</div>
			</div>
		</HomeCard>
	);
}
