"use client";

import { PageCard } from "@/components/page/page-card";
import type { ForecastMonth } from "@/lib/api/client";
import { categoryEnd, monthOf } from "@/lib/forecast-math";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLS = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 sm:grid-cols-[minmax(0,1.3fr)_90px_90px_90px_minmax(0,1.2fr)]";

// "<Month> by category" (spec 2026-10-28 §4): what's spent, where it's heading by month end, and against its budget.
// On a phone Spent and Budget drop out; the last column still says over / left.
export function ForecastCategories({ month, loading }: { month: ForecastMonth | undefined; loading: boolean }) {
	const money = useMoney();
	const rows = month?.categories ?? [];
	const over = rows.filter((c) => categoryEnd(c).tone === "over").length;
	return (
		<PageCard
			title={`${month ? monthOf(month.month) : "This month"} by category`}
			extra={over > 0 && <span data-testid="over-count" className="rounded-full bg-bad/10 px-2 py-0.5 text-bad normal-case">{over} will run over</span>}
			loading={loading}
			skeletonHeight={180}
			data-testid="forecast-categories"
		>
			{rows.length === 0 ? (
				<p className="text-[13.5px] text-muted-foreground">No spending by category to forecast yet.</p>
			) : (
				<div className="text-[13.5px] tabular-nums">
					<div className={cn(COLS, "label-ui pb-2 text-muted-foreground")}>
						<span>Category</span>
						<span className="max-sm:hidden">Spent</span>
						<span>Forecast</span>
						<span className="max-sm:hidden">Budget</span>
						<span>At month end</span>
					</div>
					{rows.map((c) => {
						const end = categoryEnd(c);
						return (
							<div key={c.category} data-testid="forecast-category" className={cn(COLS, "border-t border-border/60 py-2")}>
								<span className="truncate">{c.category}</span>
								<span className="max-sm:hidden">{money(Math.round(c.spent ?? 0))}</span>
								<span>{money(Math.round(c.forecast))}</span>
								<span className="text-muted-foreground max-sm:hidden">{c.budget != null ? money(c.budget) : "—"}</span>
								<span className={cn(end.tone === "over" && "text-bad", end.tone === "none" && "text-muted-foreground")}>
									{end.tone === "none" ? "no budget" : end.tone === "on" ? "on budget" : `${money(Math.round(end.by))} ${end.tone}`}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</PageCard>
	);
}
