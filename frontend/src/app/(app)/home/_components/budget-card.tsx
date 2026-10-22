"use client";

import Link from "next/link";
import type { BudgetState } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageCard } from "@/components/page/page-card";

// Overall budget = the profile's monthly budget (onboarding); per-category limits come from approved set_budget
// proposals or PUT /api/budget. Nothing here is invented: with neither, the card says so. The top four categories
// by spend show as bars: green, amber from 90% of the limit, red when over.
export function BudgetCard({ budget, monthName, today, loading }: { budget: BudgetState | null; monthName: string; today: Date; loading: boolean }) {
	const money = useMoney();
	const total = budget?.monthly_budget ?? null;
	const cats = [...(budget?.categories ?? [])].sort((a, b) => b.spent - a.spent).slice(0, 4);
	const spent = budget?.spent ?? 0;
	const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
	const pct = total ? Math.round((spent / total) * 100) : 0;

	return (
		<PageCard title={`Budget in ${monthName}`} href="/budget" loading={loading} skeletonHeight={64} data-testid="budget-card">
			{total ? (
				<>
					<div className="text-[26px] leading-tight font-medium tracking-tight tabular-nums">
						{money(spent)} <span className="text-[13px] font-normal tracking-normal text-muted-foreground">of {money(total)}</span>
					</div>
					<div className="mt-2.5 flex items-center gap-2.5">
						<div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
							<i className={cn("block h-full rounded-full", spent > total ? "bg-bad" : "bg-good")} style={{ width: `${Math.min(100, pct)}%` }} />
						</div>
						<span className="text-[12.5px] text-muted-foreground tabular-nums">{pct}%</span>
					</div>
					<p className="mt-1.5 text-[12px] text-muted-foreground">
						{spent > total
							? `${money(spent - total)} over`
							: `${money(total - spent)} left · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} · ~${money((total - spent) / daysLeft)}/day`}
					</p>
				</>
			) : cats.length === 0 ? (
				<>
					<p className="text-[15px] font-medium">No budget yet</p>
					<p className="mt-1 text-[12.5px] text-muted-foreground">Lumen can draft one from your last 3 months.</p>
				</>
			) : null}
			{cats.length > 0 && (
				<div className={cn("flex flex-col gap-2", total && "mt-3.5")}>
					{cats.map((c) => {
						const used = c.limit > 0 ? c.spent / c.limit : 0;
						const over = c.spent > c.limit;
						return (
							<div key={c.category} data-testid="budget-cat" data-category={c.category} data-over={over || undefined} className="text-[12.5px]">
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate">{c.category}</span>
									<span className={cn("shrink-0 tabular-nums", over ? "text-bad" : "text-muted-foreground")}>
										{money(c.spent)} / {money(c.limit)}
									</span>
								</div>
								<div className="mt-1 h-[5px] overflow-hidden rounded-full bg-muted">
									<i
										className={cn("block h-full rounded-full", over ? "bg-bad" : used >= 0.9 ? "bg-amber-500" : "bg-primary")}
										style={{ width: `${Math.min(100, used * 100)}%` }}
									/>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</PageCard>
	);
}

// "Let Lumen draft your budget": the draft itself lives on the Budget page (Phase 5d); ?draft=1 files it on arrival.
export function DraftBudgetPromo() {
	return (
		<section className="rounded-[14px] bg-accent-soft px-4 py-3.5">
			<h3 className="text-[15px] font-semibold">Let Lumen draft your budget</h3>
			<p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
				Built from 3 months of your actual spending. You approve every line before it&apos;s saved.
			</p>
			<Link href="/budget?draft=1" className="label-ui mt-2.5 inline-block rounded-full bg-foreground px-3.5 py-1.5 text-background">
				Draft budget
			</Link>
		</section>
	);
}
