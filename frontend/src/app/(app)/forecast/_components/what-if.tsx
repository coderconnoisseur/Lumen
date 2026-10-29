"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { PageCard } from "@/components/page/page-card";
import type { ForecastData } from "@/lib/api/client";
import { monthOf, whatIf } from "@/lib/forecast-math";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// What if (spec 2026-10-28 §4): try-only, in the browser. Switch off a bill or subscription, or add a monthly cost, and
// see the next three months move (this month is mostly spent). Nothing is saved; "Make it real" goes where it can be.
export function WhatIf({ data, loading }: { data: ForecastData | null; loading: boolean }) {
	const money = useMoney();
	const [off, setOff] = useState<Set<string>>(new Set());
	const [adding, setAdding] = useState(false);
	const [cost, setCost] = useState("");
	const items = data?.items ?? [];
	const offTotal = items.filter((i) => off.has(i.vendor)).reduce((s, i) => s + i.monthly_equivalent, 0);
	const add = adding ? Math.max(0, Number(cost) || 0) : 0;
	const on = off.size > 0 || adding;
	const flip = (vendor: string) =>
		setOff((s) => {
			const n = new Set(s);
			if (!n.delete(vendor)) n.add(vendor);
			return n;
		});
	return (
		<PageCard title="What if" extra={<span className="normal-case">try it, nothing is saved</span>} loading={loading} skeletonHeight={120} data-testid="what-if">
			<div className="grid gap-2 text-[13.5px]">
				{items.map((i) => (
					<Toggle key={i.vendor} on={off.has(i.vendor)} onClick={() => flip(i.vendor)} label={`Cancel ${i.vendor}`}>
						<span className="ml-auto text-muted-foreground tabular-nums">−{money(Math.round(i.monthly_equivalent))} / month</span>
					</Toggle>
				))}
				<Toggle on={adding} onClick={() => setAdding((v) => !v)} label="Add a monthly cost">
					<span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground">
						<input
							aria-label="Monthly cost"
							inputMode="decimal"
							placeholder="5000"
							value={cost}
							onChange={(e) => setCost(e.target.value)}
							className="h-7 w-20 rounded-md border border-border bg-card px-2 text-right text-foreground tabular-nums"
						/>
						/ month
					</span>
				</Toggle>
			</div>
			<div className="mt-3 border-t border-border/60 pt-3 text-[13.5px] tabular-nums">
				{!on || !data ? (
					<p className="text-muted-foreground">Turn one on to see the next three months move.</p>
				) : (
					<>
						{whatIf(data.months, offTotal, add).map((e) => (
							<p key={e.month} data-testid="effect">
								{monthOf(e.month)}: {e.kind === "left" ? "left " : ""}
								<b className="font-medium">{money(Math.round(e.now))}</b> <span className="text-muted-foreground">(was {money(Math.round(e.was))})</span>
							</p>
						))}
						<p className="mt-2 flex flex-wrap gap-x-3 text-muted-foreground">
							Make it real:
							{off.size > 0 && (
								<Link href="/bills" className="text-primary hover:underline">
									Cancel on Bills ›
								</Link>
							)}
							{adding && (
								<Link href="/budget" className="text-primary hover:underline">
									Set a limit on Budget ›
								</Link>
							)}
						</p>
					</>
				)}
			</div>
		</PageCard>
	);
}

function Toggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
	return (
		<div className="flex items-center gap-2.5">
			<button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className="flex items-center gap-2.5 text-left">
				<span className={cn("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
					<span className={cn("absolute top-0.5 size-3.5 rounded-full bg-white transition-[left]", on ? "left-[15px]" : "left-0.5")} />
				</span>
				<span aria-hidden>{label}</span>
			</button>
			{children}
		</div>
	);
}
