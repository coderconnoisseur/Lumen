"use client";

import { useEffect, useState } from "react";
import { animate } from "motion/react";
import { Plus } from "lucide-react";
import { PageCard } from "@/components/page/page-card";
import { pickTicks, smoothPath } from "@/lib/chart";
import { useMoney } from "@/lib/format";
import { dayIndex, ordinal, parseDay, sameDayDelta, type Period, type Range } from "@/lib/home-math";
import { cn } from "@/lib/utils";
import type { Forecast, Reminder } from "../use-home-data";

const RANGES: Range[] = ["1W", "1M", "3M", "YTD"];
const W = 1000;
const H = 200;
const monthLong = (d: Date) => d.toLocaleString("en-US", { month: "long" });
const dayMonth = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short" });

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

// The width the tick labels are laid out in, so they can be spaced in real pixels at any screen size. A callback
// ref: the axis only exists once the card has data, after the first render.
function useWidth() {
	const [el, setEl] = useState<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(800);
	useEffect(() => {
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
		ro.observe(el);
		return () => ro.disconnect();
	}, [el]);
	return [setEl, width] as const;
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
	const [axis, width] = useWidth();
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
	const max = Math.max(total, prev[prev.length - 1] ?? 0, fc[fc.length - 1] ?? 0, 1);
	const x = (i: number) => (period.days > 1 ? (i / (period.days - 1)) * W : 0);
	const y = (v: number) => H - (v / max) * (H - 16);
	const pts = (vals: number[], from = 0) => vals.map((v, i) => [x(i + from), y(v)] as [number, number]);
	const actual = pts(cur.slice(0, t + 1));

	const pins = reminders.filter((r) => {
		if (r.type !== "upcoming") return false;
		const i = dayIndex(period, parseDay(r.date));
		return i > t && i < period.days;
	});

	// Today always shows; the two ends unless they'd touch it; the dates in between only where they fit. 1W/1M label
	// those by day number, 3M by day and month, YTD by the 1st of each month. Widths are estimated (12.5px UI font).
	const px = (i: number) => (x(i) / W) * width;
	const at = (i: number) => new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
	const last = period.days - 1;
	const middle = (i: number) =>
		range === "YTD" ? at(i).getDate() === 1 : i % 7 === 0;
	const ticks = pickTicks(
		Array.from({ length: period.days }, (_, i) => i)
			.filter((i) => i === 0 || i === t || i === last || middle(i))
			.map((i) => {
				const label =
					i === t ? "Today"
					: i === 0 || i === last || range === "3M" ? dayMonth(at(i))
					: range === "YTD" ? at(i).toLocaleString("en-GB", { month: "short" })
					: String(at(i).getDate());
				return {
					i,
					label,
					x: px(i),
					w: label.length * 7 + 2,
					anchor: (i === 0 ? "start" : i === last ? "end" : "middle") as "start" | "end" | "middle",
					rank: i === t ? 0 : i === 0 || i === last ? 1 : 2,
				};
			}),
		8,
	);

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
				<>
					<div className="relative mt-3 h-[200px]">
						<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
							<defs>
								<linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0" stopColor="var(--primary)" stopOpacity=".26" />
									<stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
								</linearGradient>
							</defs>
							{[0.25, 0.5, 0.75].map((f) => (
								<line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--border)" strokeOpacity=".6" vectorEffect="non-scaling-stroke" />
							))}
							{prev.length > 1 && (
								<path data-series="previous" d={smoothPath(pts(prev.slice(0, period.days)))} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
							)}
							<path d={`${smoothPath(actual)} L${x(t)} ${H} L0 ${H}Z`} fill="url(#spend-fill)" />
							<path data-series="current" d={smoothPath(actual)} fill="none" stroke="var(--primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
							{fc.length > 0 && (
								<path data-series="forecast" d={smoothPath(pts([total, ...fc], t))} fill="none" stroke="var(--primary)" strokeOpacity=".6" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
							)}
							<line x1={x(t)} x2={x(t)} y1={y(total)} y2={H} stroke="var(--primary)" strokeOpacity=".25" vectorEffect="non-scaling-stroke" />
						</svg>
						{/* HTML overlays keep text and dots crisp while the svg stretches */}
						<span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary shadow-sm" style={{ left: `${(x(t) / W) * 100}%`, top: `${(y(total) / H) * 100}%` }} />
						{pins.map((p) => {
							const i = dayIndex(period, parseDay(p.date));
							return (
								<span
									key={p.id}
									data-testid="bill-pin"
									title={p.vendor}
									className="absolute bottom-0 flex size-[22px] -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-[10px] font-medium text-foreground/80"
									style={{ left: `${(x(i) / W) * 100}%` }}
								>
									{p.vendor.charAt(0).toUpperCase()}
								</span>
							);
						})}
					</div>
					<div ref={axis} className="label-ui relative mt-4 h-4 text-muted-foreground">
						{ticks.map(({ i, label }) => (
							<span
								key={i}
								data-testid="tick"
								className={cn(
									"absolute -translate-x-1/2 whitespace-nowrap",
									i === 0 && "translate-x-0",
									i === period.days - 1 && "-translate-x-full",
									i === t && "font-semibold text-primary",
								)}
								style={{ left: `${(x(i) / W) * 100}%` }}
							>
								{label}
							</span>
						))}
					</div>
				</>
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
