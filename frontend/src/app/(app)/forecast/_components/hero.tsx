"use client";

import { CumulativeChart } from "@/components/page/cumulative-chart";
import { PageCard } from "@/components/page/page-card";
import type { ForecastData } from "@/lib/api/client";
import { monthOf } from "@/lib/forecast-math";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// "<Month> lands at" (spec 2026-10-28 §4): the forecast, its likely range, how it splits (spent so far + bills still
// due + everyday spending for the days left), and the month day by day: spent (solid), forecast (dotted) fanning out
// to its range, the budget dashed, and the bills still due pinned on the axis.
export function ForecastHero({ data, today, loading }: { data: ForecastData | null; today: Date; loading: boolean }) {
	const money = useMoney();
	const m = data?.months[0];
	const name = m ? monthOf(m.month) : "This month";
	const y = today.getFullYear();
	const mo = today.getMonth();
	const days = new Date(y, mo + 1, 0).getDate();
	const span = { start: new Date(y, mo, 1), end: new Date(y, mo, days), days };
	const ym = `${y}-${String(mo + 1).padStart(2, "0")}`;
	const c = data?.current;
	return (
		<PageCard
			title={`${name} lands at`}
			extra={
				m?.budget != null && (
					<span className={cn("rounded-full px-2 py-0.5 normal-case", m.over_budget ? "bg-bad/10 text-bad" : "bg-good/10 text-good")}>
						{m.over_budget ? "Over budget" : "In budget"}
					</span>
				)
			}
			loading={loading}
			skeletonHeight={262}
			data-testid="forecast-hero"
		>
			{m && c && data && (
				<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
					<div className="min-w-0">
						<div data-testid="hero-total" className="flex h-11 items-baseline gap-2 text-[36px] leading-tight font-medium tracking-tight tabular-nums">
							{money(Math.round(m.forecast))}
							<span className="text-[13px] font-normal tracking-normal text-muted-foreground">
								by {span.end.toLocaleString("en-GB", { day: "numeric", month: "short" })}
							</span>
						</div>
						<p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
							likely {money(Math.round(m.low))} – {money(Math.round(m.high))} · spent {money(Math.round(c.spent_so_far))} so far
						</p>
						<dl data-testid="split" className="mt-4 grid gap-1.5 text-[13.5px] tabular-nums">
							<Row label="Spent so far" value={money(Math.round(c.spent_so_far))} />
							<Row label={`Bills still due (${c.bills_still_due.count})`} value={money(Math.round(c.bills_still_due.amount))} />
							<Row label={`Everyday spending, ${c.days_left} day${c.days_left === 1 ? "" : "s"}`} value={`≈ ${money(Math.round(c.everyday_rest))}`} />
							<div className="mt-1 flex justify-between border-t border-border/70 pt-2 font-medium">
								<dt>Forecast</dt>
								<dd>{money(Math.round(m.forecast))}</dd>
							</div>
						</dl>
					</div>
					<div className="min-w-0">
						<div className="label-ui flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
							<span>Day by day</span>
							<span className="ml-auto flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded bg-primary" />Spent</span>
							<span className="flex items-center gap-1.5"><i className="w-3.5 border-t-2 border-dotted border-primary/60" />Forecast</span>
							<span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary/15" />Likely range</span>
							{m.budget != null && <span className="flex items-center gap-1.5"><i className="w-3.5 border-t-2 border-dashed border-muted-foreground/50" />Budget</span>}
						</div>
						<CumulativeChart
							period={span}
							cur={data.daily.actual}
							prev={m.budget != null ? Array(days).fill(m.budget) : null}
							forecast={data.daily.path.slice(1)}
							band={{ low: data.daily.low, high: data.daily.high }}
							t={today.getDate() - 1}
							pins={data.daily.bills.map((b) => ({ id: `${b.vendor}-${b.day}`, vendor: b.vendor, date: `${ym}-${String(b.day).padStart(2, "0")}` }))}
							ticks="day"
						/>
					</div>
				</div>
			)}
		</PageCard>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between">
			<dt className="text-muted-foreground">{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}
