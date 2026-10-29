// The Forecast page's calculations (Forecast F3, spec 2026-10-28 §4). Pure: the numbers come from GET /api/forecast.
import type { ForecastData, ForecastMonth } from "@/lib/api/client";

type Category = ForecastMonth["categories"][number];

/** "2026-10" → "October" (or any other `toLocaleString` month format). */
export const monthOf = (key: string, opts: Intl.DateTimeFormatOptions = { month: "long" }) =>
	new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleString("en-US", opts);

/** "October lands near ₹82,400 · ₹12,400 over budget": the verdict is left out without a budget. */
export function headline(m: ForecastMonth, monthName: string) {
	const verdict = m.budget ? { over: m.forecast > m.budget, by: Math.abs(m.forecast - m.budget) } : null;
	return { lead: `${monthName} lands near`, amount: m.forecast, verdict };
}

/** The kept method's typical miss on the whole-month backtest; a median, so "usually", never "within". */
export function accuracyLabel(a: ForecastData["accuracy"]): string {
	if (a.months_tested < 3 || a.median_error_pct == null) return "Too little history to measure accuracy yet";
	return `Usually off by about ${Math.round(a.median_error_pct)}% · last ${a.months_tested} months`;
}

/** Where a category lands at month end against its budget. */
export function categoryEnd(c: Category): { tone: "over" | "left" | "on" | "none"; by: number } {
	if (c.budget == null) return { tone: "none", by: 0 };
	if (Math.round(c.forecast) === Math.round(c.budget)) return { tone: "on", by: 0 }; // a fixed bill exactly on its limit
	return c.forecast > c.budget ? { tone: "over", by: c.forecast - c.budget } : { tone: "left", by: c.budget - c.forecast };
}

/** Try-only: `off` a month of cancelled bills, `add` a new monthly cost, over the next three months (this one is
 *  mostly spent). Money left when there's an income, else the forecast. */
export function whatIf(months: ForecastMonth[], off: number, add: number) {
	return months.slice(1).map((m) =>
		m.left != null
			? { month: m.month, was: m.left, now: m.left + off - add, kind: "left" as const }
			: { month: m.month, was: m.forecast, now: m.forecast - off + add, kind: "forecast" as const },
	);
}

/** The hero chart's lines: spent to today, then the forecast for the days after. On the last day there are none left,
 *  so the line ends at the forecast (today's spend plus any bill due today) instead of leaving that bill off. */
export function heroSeries(daily: { actual: number[]; path: number[] }) {
	if (daily.path.length > 1) return { cur: daily.actual, forecast: daily.path.slice(1) };
	return { cur: [...daily.actual.slice(0, -1), daily.path[0] ?? daily.actual[daily.actual.length - 1] ?? 0], forecast: [] };
}

/** One scale for the four months' range bars, so they compare: the highest range end or budget, plus headroom. */
export function barScale(months: ForecastMonth[]): number {
	return Math.max(1, ...months.map((m) => Math.max(m.high, m.budget ?? 0) * 1.08));
}
