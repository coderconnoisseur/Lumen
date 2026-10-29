"use client";

import { PageCard } from "@/components/page/page-card";
import type { ForecastData } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// How this works (spec 2026-10-28 §4): the method in plain words, and both methods' backtest error on this user's own
// past months, the kept one marked. The same measure as the accuracy pill.
export function HowItWorks({ accuracy, loading }: { accuracy: ForecastData["accuracy"] | undefined; loading: boolean }) {
	const tried = accuracy && accuracy.months_tested >= 3 ? (accuracy.tried ?? []) : [];
	return (
		<PageCard title="How this works" loading={loading} skeletonHeight={110} data-testid="how-it-works">
			<p className="text-[13.5px] leading-relaxed text-foreground/80">
				Known bills on their due days, plus everyday spending learned from your past months, with a range for how much a
				month usually varies.{" "}
				{tried.length > 0
					? `Lumen tried two ways of forecasting everyday spending on your last ${accuracy!.months_tested} months and kept the more accurate one. Typical miss on a whole month:`
					: "There's too little history to measure which way forecasts you better yet, so Lumen uses your bills plus your usual everyday spending."}
			</p>
			{tried.length > 0 && (
				<div className="mt-3 flex flex-wrap gap-2 text-[13px] tabular-nums">
					{tried.map((t) => {
						const kept = t.method === accuracy!.method;
						return (
							<span key={t.method} data-testid="method" className={cn("flex items-baseline gap-2 rounded-lg border px-3 py-1.5", kept ? "border-primary/40 bg-primary/5" : "border-border/70")}>
								{t.label}
								<b className="font-medium">{Math.round(t.median_error_pct)}%</b>
								<small className="text-muted-foreground">{kept ? "kept" : "tried"}</small>
							</span>
						);
					})}
				</div>
			)}
		</PageCard>
	);
}
