"use client";

import { useEffect, useRef, useState } from "react";
import { CumulativeChart } from "@/components/page/cumulative-chart";
import { PageCard } from "@/components/page/page-card";
import { evenLine, pace } from "@/lib/budget-math";
import { useMoney } from "@/lib/format";
import { cumulative, dayIndex, period, type Txn } from "@/lib/home-math";
import { cn } from "@/lib/utils";

// Budget's hero (spec 2026-10-22 §4.4): spent of total, a bar with the even-pace tick, what's left and safe per day,
// and the running total against a straight line to the budget. `editing` swaps the total for an input in place.
export function BudgetHero({
	month,
	monthName,
	today,
	total,
	spent,
	txns,
	editing,
	onSave,
	onCancel,
	loading,
}: {
	month: Date;
	monthName: string;
	today: Date;
	total: number | null;
	spent: number;
	txns: Txn[];
	editing: boolean;
	onSave: (total: number) => void;
	onCancel: () => void;
	loading: boolean;
}) {
	const money = useMoney();
	const p = pace(total ?? 0, spent, today, month);
	const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
	const span = period(month, new Date(month.getFullYear(), month.getMonth(), days));
	const t = p.evenPct === null ? days - 1 : dayIndex(span, today);
	const over = total !== null && spent > total;
	const tone = over ? "bad" : p.vsPace !== null && p.vsPace > 0 ? "warn" : "good";
	return (
		<PageCard
			title={`Spent in ${monthName}`}
			extra={
				total !== null && (
					<span className={cn("rounded-full px-2 py-0.5 normal-case", tone === "bad" ? "bg-bad/10 text-bad" : tone === "warn" ? "bg-amber-500/10 text-amber-700" : "bg-good/10 text-good")}>
						{over ? "Over budget" : p.evenPct === null ? "Within budget" : tone === "warn" ? "Ahead of pace" : "On track"}
					</span>
				)
			}
			loading={loading}
			skeletonHeight={250}
			data-testid="budget-hero"
		>
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
				<div className="min-w-0">
					<div className="flex h-11 items-baseline gap-2 text-[36px] leading-tight font-medium tracking-tight tabular-nums">
						{money(Math.round(spent))}
						<span className="text-[13px] font-normal tracking-normal text-muted-foreground">
							{editing ? <TotalInput initial={total} onSave={onSave} onCancel={onCancel} /> : total !== null ? `of ${money(total)}` : "no budget set"}
						</span>
					</div>
					{total !== null && (
						<>
							<div className="relative mt-3 h-2.5 rounded-full bg-muted" role="img" aria-label={`${Math.round(p.pct * 100)}% of budget spent${p.evenPct !== null ? `; ${Math.round(p.evenPct * 100)}% of the month gone` : ""}`}>
								<i className={cn("block h-full rounded-full", over ? "bg-bad" : "bg-good")} style={{ width: `${Math.max(0, Math.min(100, p.pct * 100))}%` }} />
								{p.evenPct !== null && (
									<span data-testid="even-pace" title="Even pace today" className="absolute -top-1 h-[18px] w-0.5 rounded bg-foreground/60" style={{ left: `${p.evenPct * 100}%` }} />
								)}
							</div>
							<div className="label-ui mt-1.5 flex justify-between text-muted-foreground tabular-nums">
								<span>{Math.round(p.pct * 100)}% spent</span>
								{p.evenPct !== null && <span>Even pace today: {Math.round(p.evenPct * 100)}%</span>}
							</div>
							<div className="mt-5 grid grid-cols-3 gap-3">
								<Stat label={over ? "Over by" : "Left to spend"} testId="left" value={money(Math.abs(p.left))} bad={over} />
								{p.evenPct !== null && <Stat label="Days left" testId="days-left" value={String(p.daysLeft)} />}
								{p.perDay !== null && <Stat label="Safe per day" testId="per-day" value={money(Math.round(p.perDay))} />}
							</div>
						</>
					)}
				</div>
				<div className="min-w-0">
					<div className="label-ui flex items-center gap-3 text-muted-foreground">
						<span>Pace</span>
						<span className="ml-auto flex items-center gap-1.5"><i className="h-0.5 w-3.5 rounded bg-primary" />Actual</span>
						{total !== null && (
							<span className="flex items-center gap-1.5"><i className="w-3.5 border-t-2 border-dashed border-muted-foreground/50" />Even pace to {money(total)}</span>
						)}
					</div>
					<CumulativeChart period={span} cur={cumulative(txns, span)} prev={total !== null ? evenLine(total, days) : null} t={t} ticks="day" />
				</div>
			</div>
		</PageCard>
	);
}

function Stat({ label, value, testId, bad }: { label: string; value: string; testId: string; bad?: boolean }) {
	return (
		<div data-testid={testId}>
			<small className="block text-[12px] text-muted-foreground">{label}</small>
			<b className={cn("text-[17px] font-medium tabular-nums", bad && "text-bad")}>{value}</b>
		</div>
	);
}

function TotalInput({ initial, onSave, onCancel }: { initial: number | null; onSave: (v: number) => void; onCancel: () => void }) {
	const [v, setV] = useState(initial ? String(initial) : "");
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => ref.current?.focus(), []);
	return (
		<label className="inline-flex items-center gap-1">
			of
			<input
				ref={ref}
				aria-label="Monthly budget"
				inputMode="decimal"
				value={v}
				onChange={(e) => setV(e.target.value)}
				onBlur={onCancel}
				onKeyDown={(e) => {
					if (e.key === "Escape") onCancel();
					if (e.key === "Enter" && Number(v) > 0) onSave(Number(v));
				}}
				className="h-7 w-28 rounded-md border border-border bg-card px-2 text-[13px] text-foreground tabular-nums"
			/>
		</label>
	);
}
