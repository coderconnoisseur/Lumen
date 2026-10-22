import { CumulativeChart } from "@/components/page/cumulative-chart";
import { PageCard } from "@/components/page/page-card";
import { useMoney } from "@/lib/format";
import type { Period } from "@/lib/home-math";
import { cn } from "@/lib/utils";

type Month = { month: Date; total: number };
const short = (d: Date) => d.toLocaleString("en-US", { month: "short" });

// Monthly totals as bars, the current month in the accent. `tall` is the main chart for 3M/YTD (the same 232px as the
// line it replaces, so switching never moves anything); otherwise the small inset.
function MonthBars({ months, today, tall, testId }: { months: Month[]; today: Date; tall?: boolean; testId?: string }) {
	const money = useMoney();
	const max = Math.max(...months.map((m) => m.total), 1);
	return (
		<div data-testid={testId} className={cn("flex items-end gap-2", tall ? "mt-3 h-[232px]" : "h-[150px]")}>
			{months.map((m) => {
				const current = m.month.getFullYear() === today.getFullYear() && m.month.getMonth() === today.getMonth();
				return (
					<div key={m.month.toISOString()} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
						{tall && <span className="label-ui text-muted-foreground tabular-nums">{money(Math.round(m.total))}</span>}
						<div
							data-testid="month-bar"
							data-current={current || undefined}
							title={`${short(m.month)}: ${money(Math.round(m.total))}`}
							className={cn("w-full max-w-10 rounded-t-md", current ? "bg-primary" : "bg-primary/15")}
							style={{ height: `${Math.max(2, (m.total / max) * (tall ? 170 : 110))}px` }}
						/>
						<span className={cn("label-ui", current ? "font-semibold text-primary" : "text-muted-foreground")}>{short(m.month)}</span>
					</div>
				);
			})}
		</div>
	);
}

// Spending's hero (spec 2026-10-22 §4.2): the period's total and how it compares, the running total as a line (or, for
// 3M/YTD, month bars), and the last six months beside it.
export function SpendingHero({
	label,
	prevLabel,
	total,
	delta,
	period,
	cur,
	prev,
	t,
	months,
	mainMonths,
	today,
	loading,
}: {
	label: string;
	prevLabel: string;
	total: number;
	delta: { abs: number; pct: number } | null;
	period: Period;
	cur: number[];
	/** null when comparison is off */
	prev: number[] | null;
	t: number;
	/** the last six calendar months */
	months: Month[];
	/** set for 3M/YTD: the period's months, shown as the main chart */
	mainMonths: Month[] | null;
	today: Date;
	loading: boolean;
}) {
	const money = useMoney();
	const average = months.length ? months.slice(0, -1).reduce((s, m) => s + m.total, 0) / Math.max(1, months.length - 1) : 0;
	return (
		<PageCard title={`Spent in ${label}`} loading={loading} skeletonHeight={312} data-testid="spending-hero">
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
				<div className="min-w-0">
					<div className="text-[36px] leading-tight font-medium tracking-tight tabular-nums">{money(Math.round(total))}</div>
					<div className="h-5 text-[13px] text-muted-foreground">
						{delta && Math.round(delta.abs) !== 0 && (
							<span data-testid="spending-delta">
								<b className={cn("font-medium", delta.abs < 0 ? "text-good" : "text-bad")}>
									{delta.abs < 0 ? "−" : "+"}
									{money(Math.abs(Math.round(delta.abs)))} ({Math.abs(Math.round(delta.pct))}%)
								</b>{" "}
								vs {prevLabel}
							</span>
						)}
					</div>
					{mainMonths ? (
						<MonthBars months={mainMonths} today={today} tall testId="month-bars-main" />
					) : (
						<CumulativeChart period={period} cur={cur} prev={prev} t={t} ticks={period.days > 62 ? "dayMonth" : "day"} />
					)}
				</div>
				<div className="min-w-0 border-border/60 lg:border-l lg:pl-6">
					<div className="label-ui text-muted-foreground">Month by month</div>
					<div className="mt-1 text-[22px] leading-tight font-medium tracking-tight tabular-nums">
						{money(Math.round(average))} <span className="text-[12.5px] font-normal tracking-normal text-muted-foreground">avg</span>
					</div>
					<p className="mt-0.5 mb-3 text-[12px] text-muted-foreground">The five months before this one</p>
					<MonthBars months={months} today={today} />
				</div>
			</div>
		</PageCard>
	);
}
