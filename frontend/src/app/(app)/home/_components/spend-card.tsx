"use client";

import { useEffect, useState } from "react";
import { CumulativeChart } from "@/components/page/cumulative-chart";
import { animate } from "motion/react";
import { Plus } from "lucide-react";
import { PageCard } from "@/components/page/page-card";
import { useMoney } from "@/lib/format";
import { dayIndex, ordinal, parseDay, sameDayDelta, type Period, type Range } from "@/lib/home-math";
import { cn } from "@/lib/utils";
import type { Forecast, Reminder } from "../use-home-data";

const RANGES: Range[] = ["1W", "1M", "3M", "YTD"];
const monthLong = (d: Date) => d.toLocaleString("en-US", { month: "long" });

function title(range: Range, period: Period) {
	if (range === "1M") return `Spent in ${monthLong(period.start)}`;
	if (range === "YTD") return `Spent in ${period.start.getFullYear()}`;
	return range === "1W" ? "Spent this week" : "Spent this quarter";
}

function compared(range: Range, previous: Period, today: Date) {
	if (range === "1M") return `vs ${monthLong(previous.start)} by the ${ordinal(today.getDate())}`;
	if (range === "YTD") return `vs ${previous.start.getFullYear()} at this point`;
	return range === "1W" ? "vs last week at this point" : "vs last quarter at this point";
}

// Counts up once per browser session, then shows the number straight away (motion rule: no replay on revisits).
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
	const [shown, setShown] = useState(value);
	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let seen = false;
		try {
			seen = sessionStorage.getItem("home-countup") === "1";
			sessionStorage.setItem("home-countup", "1");
		} catch {}
		if (reduce || seen || value <= 0) return setShown(value);
		const c = animate(0, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
		return () => c.stop();
	}, [value]);
	return <>{format(shown)}</>;
}

// Home's hero (spec 2026-10-22 §4.1, Origin style): the period's total, how it compares, where it's heading, and the
// running total as a smooth line against the previous period, with upcoming bills pinned on the axis.
export function SpendCard({
	range,
	onRange,
	onUpload,
	period,
	previous,
	cur,
	prev,
	forecast,
	reminders,
	today,
	loading,
}: {
	range: Range;
	onRange: (r: Range) => void;
	onUpload: () => void;
	period: Period;
	previous: Period;
	cur: number[];
	prev: number[];
	forecast: Forecast;
	reminders: Reminder[];
	today: Date;
	loading: boolean;
}) {
	const money = useMoney();
	const t = Math.min(Math.max(dayIndex(period, today), 0), period.days - 1);
	const total = cur[t] ?? 0;
	const delta = sameDayDelta(cur, prev, t);

	// forecast: today's running total plus each forecast day still inside this month (1M only)
	const fc: number[] = [];
	if (range === "1M" && forecast?.dates?.length) {
		let run = total;
		let matched = 0;
		for (let i = t + 1; i < period.days; i++) {
			const day = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
			const k = forecast.dates.findIndex((d) => parseDay(d).getTime() === day.getTime());
			if (k >= 0) matched++;
			run += k >= 0 ? (forecast.values[k] ?? 0) : 0;
			fc.push(run);
		}
		// the backend forecasts from the last transaction's date; if none of its days land in this month, draw nothing
		if (!matched) fc.length = 0;
	}
	const empty = total === 0 && !prev.some((v) => v > 0);
	const pins = reminders.filter((r) => {
		if (r.type !== "upcoming") return false;
		const i = dayIndex(period, parseDay(r.date));
		return i > t && i < period.days;
	});

	const legend = (
		<span className="ml-auto mr-2 hidden items-center gap-4 sm:flex">
			<span className="flex items-center gap-1.5">
				<i className="inline-block w-4 border-t-2 border-primary" />
				Now
			</span>
			<span className="flex items-center gap-1.5">
				<i className="inline-block w-4 border-t-2 border-dashed border-muted-foreground/50" />
				Before
			</span>
			{fc.length > 0 && (
				<span className="flex items-center gap-1.5">
					<i className="inline-block w-4 border-t-2 border-dotted border-primary/60" />
					Forecast
				</span>
			)}
		</span>
	);

	return (
		<PageCard
			title={title(range, period)}
			href="/spending"
			extra={legend}
			action={
				<button
					type="button"
					aria-label="Upload a receipt"
					onClick={onUpload}
					className="flex size-7 items-center justify-center rounded-lg border border-border text-primary transition-colors hover:bg-muted"
				>
					<Plus className="size-4" />
				</button>
			}
			loading={loading}
			skeletonHeight={348}
			className="relative"
			data-testid="spend-card"
		>
			<div className="text-[36px] leading-tight font-medium tracking-tight tabular-nums">
				<CountUp value={Math.round(total)} format={(n) => money(n)} />
			</div>
			<div className="h-5 text-[13px] text-muted-foreground">
				{delta && Math.round(delta.abs) !== 0 && (
					<span data-testid="spend-delta">
						<b className={cn("font-medium", delta.abs < 0 ? "text-good" : "text-bad")}>
							{delta.abs < 0 ? "−" : "+"}
							{money(Math.abs(Math.round(delta.abs)))} ({Math.abs(Math.round(delta.pct))}%)
						</b>{" "}
						{compared(range, previous, today)}
					</span>
				)}
				{fc.length > 0 && (
					<span>
						{delta && Math.round(delta.abs) !== 0 && " · "}heading for{" "}
						<b className="font-medium text-foreground/80">{money(Math.round(fc[fc.length - 1]))}</b>
					</span>
				)}
			</div>

			{empty ? (
				<div className="mt-2 flex h-[236px] items-center justify-center text-center">
					<p className="max-w-sm font-serif text-[17px] text-muted-foreground">
						Nothing spent yet this {range === "1W" ? "week" : range === "1M" ? "month" : range === "3M" ? "quarter" : "year"}.
						Upload a receipt or import a statement and your spending will show up here.
					</p>
				</div>
			) : (
				<CumulativeChart
					period={period}
					cur={cur}
					prev={prev}
					forecast={fc}
					t={t}
					pins={pins}
					ticks={range === "YTD" ? "month" : range === "3M" ? "dayMonth" : "day"}
				/>
			)}
			<div className="mt-3 flex justify-center gap-1.5">
				{RANGES.map((r) => (
					<button
						key={r}
						type="button"
						aria-pressed={r === range}
						onClick={() => onRange(r)}
						className={cn(
							"label-ui rounded-lg px-3.5 py-1 transition-colors",
							r === range ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
						)}
					>
						{r}
					</button>
				))}
			</div>
		</PageCard>
	);
}
