"use client";

import { PageCard } from "@/components/page/page-card";
import type { BudgetMonth } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const H = 130;
const short = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleString("en-US", { month: "short" });

// The last months (spec 2026-10-22 §4.4): each month's budget as a dashed outline (only when it had one) and what was
// spent as a bar inside it, green under and red over. This month is "so far", with a pale bar for where it's heading
// at the pace so far. Beside it the track record over the past months that had a budget.
export function BudgetHistory({ months, today, forecast, loading }: { months: BudgetMonth[]; today: Date; forecast: number | null; loading: boolean }) {
	const money = useMoney();
	const now = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
	// this month heads for the app's forecast (GET /api/forecast); without one, only what's spent is drawn
	const projected = (m: BudgetMonth) => (m.month === now && forecast !== null ? Math.max(forecast, m.spent) : m.spent);
	const max = Math.max(...months.map((m) => Math.max(m.budget ?? 0, projected(m))), 1);
	const h = (v: number) => Math.max(2, (v / max) * H);
	const judged = months.filter((m) => m.month !== now && m.budget !== null);
	const under = judged.filter((m) => m.spent <= m.budget!).length;
	const overMonths = judged.filter((m) => m.spent > m.budget!).map((m) => new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5)) - 1, 1).toLocaleString("en-US", { month: "long" }));

	return (
		<PageCard
			title={`Last ${months.length || 6} months`}
			extra={
				<span className="ml-2 flex flex-wrap gap-3 normal-case max-sm:hidden">
					<span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-good" />Within budget</span>
					<span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-bad" />Over</span>
					<span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm border border-dashed border-muted-foreground/60" />Budget</span>
				</span>
			}
			loading={loading}
			skeletonHeight={176}
			data-testid="budget-history"
		>
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
				<div className="flex h-[176px] items-end gap-1.5 sm:gap-3">
					{months.map((m) => {
						const cur = m.month === now;
						const over = m.budget !== null && m.spent > m.budget;
						return (
							<div key={m.month} data-testid="history-month" data-over={over || undefined} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
								{/* amounts don't fit six across a phone; the bar's title still has them */}
								<span className={cn("label-ui tabular-nums max-sm:hidden", over ? "text-bad" : "text-muted-foreground")}>{money(Math.round(m.spent))}</span>
								<div title={`${short(m.month)}: ${money(Math.round(m.spent))}`} className="relative flex w-full max-w-14 items-end justify-center" style={{ height: h(Math.max(m.budget ?? 0, projected(m))) }}>
									{m.budget !== null && (
										<span data-testid="history-budget" title={`Budget ${money(m.budget)}`} className="absolute inset-x-0 bottom-0 rounded-md border border-dashed border-muted-foreground/50" style={{ height: h(m.budget) }} />
									)}
									{cur && forecast !== null && <span data-testid="history-forecast" title={`Forecast: ${money(Math.round(projected(m)))}`} className="absolute inset-x-1.5 bottom-0 rounded-t-[5px] bg-good/15" style={{ height: h(projected(m)) }} />}
									<span className={cn("relative mx-1.5 w-full rounded-t-[5px]", over ? "bg-bad/90" : "bg-good/90", cur && "opacity-75")} style={{ height: h(m.spent) }} />
								</div>
								<span className={cn("label-ui whitespace-nowrap", cur ? "font-semibold text-foreground" : "text-muted-foreground")}>
									{short(m.month)}
									{cur && <span className="max-sm:hidden"> · so far</span>}
								</span>
							</div>
						);
					})}
				</div>
				{judged.length > 0 && (
					<div data-testid="track-record" className="self-center">
						<span className="label-ui text-muted-foreground">Track record</span>
						<div className="mt-1 text-[24px] font-medium tracking-tight tabular-nums">
							{under} of {judged.length} <small className="text-[13px] font-normal tracking-normal text-muted-foreground">months under</small>
						</div>
						<p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
							{overMonths.length ? `Over in ${overMonths.join(", ")}.` : "Under budget every month."}
						</p>
					</div>
				)}
			</div>
		</PageCard>
	);
}
