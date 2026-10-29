// Node-only unit tests (no browser) for the Forecast page's calculations (Forecast F3).
import { test, expect } from "@playwright/test";
import { accuracyLabel, barScale, categoryEnd, headline, whatIf } from "../src/lib/forecast-math";
import type { ForecastMonth } from "../src/lib/api/client";

const m = (month: string, forecast: number, o: Partial<ForecastMonth> = {}): ForecastMonth => ({
	month, forecast, low: forecast - 3000, high: forecast + 3000, bills: 0, everyday: forecast, budget: null, income: null,
	left: null, over_budget: null, why: "", categories: [], ...o,
});

test("headline: over budget, under budget, no budget", () => {
	expect(headline(m("2026-10", 82400, { budget: 70000 }), "October")).toEqual({ lead: "October lands near", amount: 82400, verdict: { over: true, by: 12400 } });
	expect(headline(m("2026-10", 60000, { budget: 70000 }), "October").verdict).toEqual({ over: false, by: 10000 });
	expect(headline(m("2026-10", 60000), "October").verdict).toBeNull();
});

test("accuracy label: the kept method's median error, or too little history", () => {
	expect(accuracyLabel({ months_tested: 6, median_error_pct: 12.8 })).toBe("Usually off by about 13% · last 6 months");
	expect(accuracyLabel({ months_tested: 2 })).toBe("Too little history to measure accuracy yet");
});

test("category end: over, left, or no budget", () => {
	expect(categoryEnd({ category: "Shopping", spent: 18514, forecast: 19100, budget: 9000 })).toEqual({ tone: "over", by: 10100 });
	expect(categoryEnd({ category: "Food", spent: 5095, forecast: 6000, budget: 6500 })).toEqual({ tone: "left", by: 500 });
	expect(categoryEnd({ category: "Transport", spent: 2937, forecast: 3800, budget: null })).toEqual({ tone: "none", by: 0 });
	expect(categoryEnd({ category: "Housing", spent: 22000, forecast: 22000.4, budget: 22000 })).toEqual({ tone: "on", by: 0 });
});

test("what if: changes the next three months only; money left with income, the forecast without", () => {
	const withIncome = [0, 1, 2, 3].map((i) => m(`2026-1${i}`, 66000, { income: 85000, left: 19000 }));
	expect(whatIf(withIncome, 766, 5000)).toEqual([1, 2, 3].map((i) => ({ month: `2026-1${i}`, was: 19000, now: 19000 + 766 - 5000, kind: "left" })));
	const noIncome = [0, 1, 2, 3].map((i) => m(`2026-1${i}`, 66000));
	expect(whatIf(noIncome, 1500, 0)[0]).toEqual({ month: "2026-11", was: 66000, now: 64500, kind: "forecast" });
});

test("bar scale: the highest range end or budget across the months, with headroom", () => {
	expect(barScale([m("a", 80000, { budget: 70000 }), m("b", 60000, { budget: 100000 })])).toBeCloseTo(108000);
	expect(barScale([m("a", 0, { low: 0, high: 0 })])).toBe(1);
});
