"use client";

import { useState } from "react";
import { PageCard } from "@/components/page/page-card";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/components/profile/profile-provider";
import { profileApi, type ForecastMonth } from "@/lib/api/client";
import { barScale, monthOf } from "@/lib/forecast-math";
import { useMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// This month and the next three (spec 2026-10-28 §4): each month's forecast, its likely range on one shared scale
// with the budget as a tick, money left of the profile's income, and the one "why" line. Without an income, one
// "Add your income" sets it in place (onboarding is the only other place it's asked for).
export function ForecastMonths({ months, loading, onIncome }: { months: ForecastMonth[]; loading: boolean; onIncome: () => void }) {
	const money = useMoney();
	const scale = barScale(months);
	const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
	const noIncome = months.length > 0 && months[0].income == null;
	return (
		<PageCard
			title="This month and the next three"
			action={noIncome && <AddIncome onSaved={onIncome} />}
			loading={loading}
			skeletonHeight={196}
			data-testid="forecast-months"
		>
			<div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
				{months.map((m) => (
					<div key={m.month} data-testid="forecast-month" className="min-w-0">
						<h3 className="flex items-center gap-2 text-[14px] font-medium">
							{monthOf(m.month)}
							{m.budget != null && (
								<span className={cn("label-ui rounded-full px-2 py-0.5 normal-case", m.over_budget ? "bg-bad/10 text-bad" : "bg-good/10 text-good")}>
									{m.over_budget ? "over" : "in budget"}
								</span>
							)}
						</h3>
						<div className="mt-1 text-[22px] font-medium tracking-tight tabular-nums">{money(Math.round(m.forecast))}</div>
						<div className="text-[12.5px] text-muted-foreground tabular-nums">
							{money(Math.round(m.low))} – {money(Math.round(m.high))} · {m.budget != null ? `budget ${money(m.budget)}` : "no budget yet"}
						</div>
						<div
							className="relative mt-2.5 h-2 rounded-full bg-muted"
							role="img"
							aria-label={`Likely ${money(Math.round(m.low))} to ${money(Math.round(m.high))}${m.budget != null ? `, budget ${money(m.budget)}` : ""}`}
						>
							<i className="absolute inset-y-0 rounded-full bg-primary/25" style={{ left: pct(m.low), width: `calc(${pct(m.high)} - ${pct(m.low)})` }} />
							<i className="absolute -top-0.5 h-3 w-0.5 rounded bg-primary" style={{ left: pct(m.forecast) }} />
							{m.budget != null && <i data-testid="budget-tick" className="absolute -top-1 h-4 w-0.5 rounded bg-bad" style={{ left: pct(m.budget) }} />}
						</div>
						{m.left != null && m.income != null && (
							<div className="mt-2.5 flex justify-between text-[13px] tabular-nums">
								<span className="text-muted-foreground">Left of {money(m.income)} income</span>
								<b className={cn("font-medium", m.left < 0 && "text-bad")}>{money(Math.round(m.left))}</b>
							</div>
						)}
						<p className="mt-2 text-[13px] leading-snug text-foreground/75">{m.why}</p>
					</div>
				))}
			</div>
		</PageCard>
	);
}

function AddIncome({ onSaved }: { onSaved: () => void }) {
	const { refresh } = useProfile();
	const [editing, setEditing] = useState(false);
	const [v, setV] = useState("");
	if (!editing)
		return (
			<Button variant="quiet" size="sm" className="rounded-full normal-case" onClick={() => setEditing(true)}>
				Add your income
			</Button>
		);
	const save = async () => {
		try {
			await profileApi.update({ monthly_income: Number(v) });
			setEditing(false);
			void refresh();
			onSaved();
		} catch {
			toast.error("Couldn't save your income.");
		}
	};
	return (
		<input
			autoFocus
			aria-label="Monthly income"
			inputMode="decimal"
			placeholder="Monthly income"
			value={v}
			onChange={(e) => setV(e.target.value)}
			onBlur={() => setEditing(false)}
			onKeyDown={(e) => {
				if (e.key === "Escape") setEditing(false);
				if (e.key === "Enter" && Number(v) > 0) void save();
			}}
			className="h-7 w-36 rounded-md border border-border bg-card px-2 text-[13px] normal-case text-foreground tabular-nums"
		/>
	);
}
