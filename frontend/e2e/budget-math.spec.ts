// Node-only unit tests (no browser) for the Budget page's calculations (UI revamp Phase 5d).
import { test, expect } from "@playwright/test";
import { evenLine, pace, runRate, usedTone } from "../src/lib/budget-math";

const today = new Date(2026, 9, 22); // 22 Oct 2026; October has 31 days
const october = new Date(2026, 9, 1);

test("pace: this month has an even-pace mark, days left and a safe amount per day", () => {
	const p = pace(100000, 62182, today, october);
	expect(p.pct).toBeCloseTo(0.62182);
	expect(p.evenPct).toBeCloseTo(22 / 31);
	expect(p.left).toBe(37818);
	expect(p.daysLeft).toBe(10); // today counts
	expect(p.perDay).toBeCloseTo(3781.8);
	expect(p.vsPace).toBeCloseTo(62182 - (100000 * 22) / 31); // negative = under an even pace
});

test("pace: a past month has no pace, days left or per day; over budget has no per day", () => {
	const past = pace(50000, 61000, today, new Date(2026, 8, 1));
	expect([past.evenPct, past.daysLeft, past.perDay, past.vsPace]).toEqual([null, 0, null, null]);
	expect(past.left).toBe(-11000);
	expect(pace(50000, 61000, today, october).perDay).toBeNull();
	expect(pace(0, 500, today, october).pct).toBe(0);
});

test("usedTone: green, amber from 90%, red when over", () => {
	expect(usedTone(899, 1000)).toBe("good");
	expect(usedTone(900, 1000)).toBe("warn");
	expect(usedTone(1000, 1000)).toBe("warn");
	expect(usedTone(1001, 1000)).toBe("bad");
});

test("evenLine reaches the budget on the last day; runRate projects the month", () => {
	const line = evenLine(31000, 31);
	expect([line[0], line[30], line.length]).toEqual([1000, 31000, 31]);
	expect(runRate(22000, today)).toBe(31000);
});
