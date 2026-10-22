import Link from "next/link";
import { PageCard } from "@/components/page/page-card";
import { VendorChip } from "@/components/page/vendor-chip";
import { useMoney } from "@/lib/format";
import { calendarBuckets, dayIndex, heat, parseDay, type Period, type Txn } from "@/lib/home-math";
import { cn } from "@/lib/utils";
import type { Reminder } from "../use-home-data";

// "₹2.2k" in the user's own currency: take the symbol from how useMoney prints zero
const kShort = (n: number, symbol: string) => (n >= 1000 ? `${symbol}${(n / 1000).toFixed(1)}k` : `${symbol}${Math.round(n)}`);
const dayMonth = (s: string) => parseDay(s).toLocaleString("en-GB", { day: "numeric", month: "short" });
const monthLong = (d: Date) => d.toLocaleString("en-US", { month: "long" });

// This month day by day (spec 2026-10-22 §4.1): what each day cost, darker = more, today outlined, and the bills
// still to come named on their days; the latest transactions beside it. The card is always as tall as a six-week
// month, so it never changes height between loading and loaded, or from one month to the next.
export function CalendarCard({
	txns,
	reminders,
	period,
	today,
	loading,
}: {
	txns: Txn[];
	reminders: Reminder[];
	period: Period;
	today: Date;
	loading: boolean;
}) {
	const money = useMoney();
	const symbol = money(0).replace(/[\d.,\s]/g, "");
	const days = calendarBuckets(txns, period);
	const max = Math.max(...days.map((d) => d.amount), 0);
	const total = days.reduce((s, d) => s + d.amount, 0);
	const spentDays = days.filter((d) => d.amount > 0).length;
	const t = dayIndex(period, today);
	const lead = (period.start.getDay() + 6) % 7; // Monday first
	const recent = [...txns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
	const billOn = new Map<number, string>();
	for (const r of reminders) {
		const i = dayIndex(period, parseDay(r.date));
		if (r.type === "upcoming" && i > t && i < period.days && !billOn.has(i)) billOn.set(i, r.vendor);
	}

	return (
		<PageCard title={`${monthLong(period.start)}, day by day`} href="/spending" loading={loading} skeletonHeight={386} data-testid="calendar-card">
			<div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
				<div className="min-w-0">
					<div className="mb-3 text-[26px] leading-tight font-medium tracking-tight tabular-nums">
						{money(Math.round(total))}{" "}
						<span className="text-[13px] font-normal tracking-normal text-muted-foreground">
							across {spentDays} {spentDays === 1 ? "day" : "days"}
						</span>
					</div>
					<div className="grid grid-cols-7 gap-1">
						{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
							<div key={i} className="pb-0.5 text-center text-[10.5px] text-muted-foreground/70">
								{d}
							</div>
						))}
						{Array.from({ length: lead }, (_, i) => (
							<div key={`b${i}`} />
						))}
						{days.map(({ day, amount }, i) => {
							const h = heat(amount, max);
							const future = i > t;
							const bill = billOn.get(i);
							return (
								<div
									key={day}
									data-testid={`cal-day-${day}`}
									data-today={i === t || undefined}
									data-future={future || undefined}
									className={cn(
										"flex h-[50px] flex-col justify-between overflow-hidden rounded-[7px] border px-1.5 py-1 text-[10.5px] leading-tight text-muted-foreground",
										future ? "border-dashed border-border" : "border-border/60",
										i === t && "outline-[1.5px] outline-primary outline-solid -outline-offset-1",
									)}
									style={h ? { background: `color-mix(in srgb, var(--primary) ${Math.round(h * 100)}%, transparent)`, color: h > 0.5 ? "#fff" : undefined } : undefined}
								>
									{day}
									{amount > 0 && <b className="truncate font-medium text-inherit">{kShort(amount, symbol)}</b>}
									{future && bill && <b className="truncate font-medium text-foreground/70">{bill}</b>}
								</div>
							);
						})}
					</div>
				</div>
				<div className="min-w-0">
					<div className="label-ui mb-1 flex items-center text-muted-foreground">
						Recent transactions
						<Link href="/spending" className="ml-auto hover:text-foreground">
							See all
						</Link>
					</div>
					{recent.length === 0 ? (
						<p className="text-sm text-muted-foreground">No transactions this month yet.</p>
					) : (
						recent.map((t) => (
							<div key={t.id} data-testid="recent-row" className="flex items-center gap-2.5 border-b border-border/60 py-2 text-[13px] last:border-0">
								<VendorChip name={t.vendor_name ?? "Unknown"} />
								<span className="min-w-0 flex-1">
									<span className="block truncate">{t.vendor_name ?? "Unknown"}</span>
									<span className="block truncate text-[11.5px] text-muted-foreground">
										{dayMonth(t.date)} · {t.category ?? "Uncategorised"}
									</span>
								</span>
								<span className="shrink-0 font-medium tabular-nums">{money(t.total_amount ?? 0)}</span>
							</div>
						))
					)}
				</div>
			</div>
		</PageCard>
	);
}
