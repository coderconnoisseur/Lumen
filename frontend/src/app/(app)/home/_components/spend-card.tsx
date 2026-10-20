"use client";

import { useEffect, useState } from "react";
import { animate } from "motion/react";
import { useMoney } from "@/lib/format";
import { dayIndex, parseDay, sameDayDelta, type Period, type Range } from "@/lib/home-math";
import { cn } from "@/lib/utils";
import type { Forecast, Reminder } from "../use-home-data";
import { HomeCard } from "./card";

const RANGES: Range[] = ["1W", "1M", "3M", "YTD"];
const TITLE: Record<Range, string> = { "1W": "Spent this week", "1M": "Spent this month", "3M": "Spent this quarter", YTD: "Spent this year" };
const W = 860;
const H = 160;
const short = (d: Date) => d.toLocaleString("en-GB", { month: "short" });
const tick = (d: Date) => d.toLocaleString("en-GB", { day: "2-digit", month: "short" });

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

export function SpendCard({
	range,
	onRange,
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
		for (let i = t + 1; i < period.days; i++) {
			const day = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
			const k = forecast.dates.findIndex((d) => parseDay(d).getTime() === day.getTime());
			run += k >= 0 ? (forecast.values[k] ?? 0) : 0;
			fc.push(run);
		}
	}
	const max = Math.max(total, prev[prev.length - 1] ?? 0, fc[fc.length - 1] ?? 0, 1);
	const x = (i: number) => (period.days > 1 ? (i / (period.days - 1)) * W : 0);
	const y = (v: number) => H - (v / max) * (H - 20);
	const line = (vals: number[], from = 0) => vals.map((v, i) => `${i ? "L" : "M"}${x(i + from).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
	const actual = cur.slice(0, t + 1);

	const pins = reminders.filter((r) => {
		if (r.type !== "upcoming") return false;
		const i = dayIndex(period, parseDay(r.date));
		return i > t && i < period.days;
	});

	const ticks = [0, Math.round((period.days - 1) * 0.25), Math.round((period.days - 1) * 0.5), t, period.days - 1]
		.filter((v, i, a) => a.indexOf(v) === i)
		.sort((a, b) => a - b);
	const vsLabel =
		range === "1M" ? `vs ${short(previous.start)} at this point` : range === "YTD" ? `vs ${previous.start.getFullYear()} at this point` : "vs last period at this point";

	return (
		<HomeCard title={TITLE[range]} loading={loading} skeletonHeight={262} className="relative" data-testid="spend-card">
			<div className="flex items-end gap-4">
				<div>
					<div className="text-[28px] font-medium tracking-tight">
						<CountUp value={Math.round(total)} format={(n) => money(n)} />
					</div>
					<div className="h-[18px] text-[12.5px]">
						{delta && Math.round(delta.abs) !== 0 && (
							<span data-testid="spend-delta" className={delta.abs < 0 ? "text-good" : "text-bad"}>
								{delta.abs < 0 ? "↓" : "↑"} {money(Math.abs(Math.round(delta.abs)))} {vsLabel}
							</span>
						)}
					</div>
				</div>
				<div className="label-mono ml-auto hidden gap-3 text-muted-foreground sm:flex">
					<span>— now</span>
					<span>┄ before</span>
					{fc.length > 0 && <span>· forecast</span>}
				</div>
			</div>

			<div className="relative mt-2 h-[150px]">
				<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
					<defs>
						<linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stopColor="var(--primary)" stopOpacity=".25" />
							<stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
						</linearGradient>
					</defs>
					{prev.length > 1 && (
						<path data-series="previous" d={line(prev.slice(0, period.days))} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".5" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
					)}
					<path d={`${line(actual)} L${x(t)} ${H} L0 ${H}Z`} fill="url(#spend-fill)" />
					<path data-series="current" d={line(actual)} fill="none" stroke="var(--primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
					{fc.length > 0 && (
						<path data-series="forecast" d={line([total, ...fc], t)} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
					)}
					<line x1={x(t)} x2={x(t)} y1={y(total)} y2={H} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
				</svg>
				{/* HTML overlays keep text and dots crisp while the svg stretches */}
				<span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: `${(x(t) / W) * 100}%`, top: `${(y(total) / H) * 100}%` }} />
				{pins.map((p) => {
					const i = dayIndex(period, parseDay(p.date));
					return (
						<span key={p.id} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${(x(i) / W) * 100}%`, top: 0 }}>
							<span data-testid="bill-pin" className="label-mono max-w-24 truncate text-muted-foreground">
								{p.vendor}
							</span>
							<span className="mt-0.5 size-2 rounded-full border-2 border-bad bg-card" />
						</span>
					);
				})}
			</div>
			<div className="label-mono relative mt-1 h-4 text-muted-foreground">
				{ticks.map((i) => (
					<span key={i} className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full" style={{ left: `${(x(i) / W) * 100}%` }}>
						{i === t ? "today" : tick(new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i))}
					</span>
				))}
			</div>
			<div className="mt-3 flex justify-center gap-1.5">
				{RANGES.map((r) => (
					<button
						key={r}
						type="button"
						aria-pressed={r === range}
						onClick={() => onRange(r)}
						className={cn(
							"label-mono rounded-md px-2.5 py-1 transition-colors",
							r === range ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
						)}
					>
						{r}
					</button>
				))}
			</div>
		</HomeCard>
	);
}
