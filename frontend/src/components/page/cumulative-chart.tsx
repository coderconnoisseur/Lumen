"use client";

import { useEffect, useState } from "react";
import { pickTicks, smoothPath } from "@/lib/chart";
import { dayIndex, parseDay, type Period } from "@/lib/home-math";
import { cn } from "@/lib/utils";

const W = 1000;
const H = 200;
const dayMonth = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short" });

// The width the tick labels are laid out in, so they can be spaced in real pixels at any screen size. A callback
// ref: the axis only exists once the chart has data, after the first render.
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

// A period's running total as a smooth line (spec 2026-10-22 §3), with the previous period dashed behind it, an
// optional forecast dotted on from today (with its likely range as a band at the period's end), and bills pinned on
// the axis. Used by Home's, Spending's, Budget's and Forecast's heroes.
// `ticks`: "day" labels the dates in between by day number (a week or a month), "dayMonth" by day and month (a few
// months), "month" by each month's 1st (a year). Always 232px tall (chart and axis) whatever the data.
export function CumulativeChart({
	period,
	cur,
	prev,
	forecast = [],
	t,
	pins = [],
	band,
	ticks: style,
}: {
	period: Period;
	cur: number[];
	/** the previous period's running total, or null to leave it out */
	prev: number[] | null;
	/** running totals for the days after today */
	forecast?: number[];
	/** today's index in the period (already clamped to it) */
	t: number;
	pins?: { id: string | number; vendor: string; date: string }[];
	/** the forecast's likely range at the period's end, drawn as a band fanning out from today */
	band?: { low: number; high: number };
	ticks: "day" | "dayMonth" | "month";
}) {
	const [axis, width] = useWidth();
	const fc = forecast;
	const total = cur[t] ?? 0;
	const max = Math.max(total, prev?.[prev.length - 1] ?? 0, fc[fc.length - 1] ?? 0, band?.high ?? 0, 1);
	const x = (i: number) => (period.days > 1 ? (i / (period.days - 1)) * W : 0);
	const y = (v: number) => H - (v / max) * (H - 16);
	const pts = (vals: number[], from = 0) => vals.map((v, i) => [x(i + from), y(v)] as [number, number]);
	const actual = pts(cur.slice(0, t + 1));

	// Today always shows; the two ends unless they'd touch it; the dates in between only where they fit. Widths are
	// estimated (12.5px UI font).
	const px = (i: number) => (x(i) / W) * width;
	const at = (i: number) => new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i);
	const last = period.days - 1;
	const middle = (i: number) => (style === "month" ? at(i).getDate() === 1 : i % 7 === 0);
	const ticks = pickTicks(
		Array.from({ length: period.days }, (_, i) => i)
			.filter((i) => i === 0 || i === t || i === last || middle(i))
			.map((i) => {
				const label =
					i === t ? "Today"
					: i === 0 || i === last || style === "dayMonth" ? dayMonth(at(i))
					: style === "month" ? at(i).toLocaleString("en-GB", { month: "short" })
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

	return (
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
					{prev && prev.length > 1 && (
						<path data-series="previous" d={smoothPath(pts(prev.slice(0, period.days)))} fill="none" stroke="var(--muted-foreground)" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
					)}
					{band && <path data-series="band" d={`M${x(t)} ${y(total)} L${x(last)} ${y(band.low)} L${x(last)} ${y(band.high)}Z`} fill="var(--primary)" fillOpacity=".1" />}
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
							i === last && "-translate-x-full",
							i === t && "font-semibold text-primary",
						)}
						style={{ left: `${(x(i) / W) * 100}%` }}
					>
						{label}
					</span>
				))}
			</div>
		</>
	);
}
