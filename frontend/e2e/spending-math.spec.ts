// Node-only unit tests (no browser) for the Spending page's calculations (UI revamp Phase 5b).
import { test, expect } from "@playwright/test";
import { byCategory, monthlyTotals, needsCategory, spendPeriods, topMerchants } from "../src/lib/spending-math";

const tx = (id: string, vendor_name: string | null, date: string, total_amount: number, category: string | null = "Food") => ({
	id,
	vendor_name,
	date,
	total_amount,
	category,
	created_at: null,
});
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("spendPeriods: this month, last month, 3M, YTD and custom", () => {
	const today = new Date(2026, 9, 22); // 22 Oct 2026
	const m = spendPeriods("this-month", today);
	expect([ymd(m.current.start), ymd(m.current.end), ymd(m.previous.start), ymd(m.previous.end)]).toEqual(["2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30"]);
	expect([m.label, m.prevLabel]).toEqual(["October", "September"]);
	const last = spendPeriods("last-month", today);
	expect([ymd(last.current.start), ymd(last.current.end), ymd(last.previous.start)]).toEqual(["2026-09-01", "2026-09-30", "2026-08-01"]);
	// January's last month is December, compared with November
	const jan = spendPeriods("last-month", new Date(2027, 0, 10));
	expect([ymd(jan.current.start), ymd(jan.previous.start), jan.label, jan.prevLabel]).toEqual(["2026-12-01", "2026-11-01", "December", "November"]);
	const ytd = spendPeriods("YTD", today);
	expect([ymd(ytd.current.start), ymd(ytd.previous.start), ytd.label, ytd.prevLabel]).toEqual(["2026-01-01", "2025-01-01", "2026", "2025"]);
	expect(spendPeriods("3M", today).label).toBe("Aug – Oct");
	// custom: inclusive, previous is the same number of days just before
	const c = spendPeriods({ from: new Date(2026, 9, 5), to: new Date(2026, 9, 11) }, today);
	expect([c.current.days, ymd(c.previous.start), ymd(c.previous.end)]).toEqual([7, "2026-09-28", "2026-10-04"]);
});

test("byCategory: amount, share and change, with uncategorised rows named", () => {
	const cur = [tx("1", "Swiggy", "2026-10-02", 600, "Food"), tx("2", "Croma", "2026-10-03", 300, "Shopping"), tx("3", "X", "2026-10-04", 100, null)];
	const prev = [tx("4", "Swiggy", "2026-09-02", 400, "Food")];
	expect(byCategory(cur, prev)).toEqual([
		{ category: "Food", amount: 600, share: 0.6, change: 200 },
		{ category: "Shopping", amount: 300, share: 0.3, change: 300 },
		{ category: "Uncategorised", amount: 100, share: 0.1, change: 100 },
	]);
	expect(byCategory([], [])).toEqual([]);
});

test("topMerchants: by amount, with visit count", () => {
	const t = [tx("1", "Swiggy", "2026-10-02", 300), tx("2", "Swiggy", "2026-10-05", 200), tx("3", "Croma", "2026-10-03", 9999, "Shopping"), tx("4", null, "2026-10-04", 50)];
	expect(topMerchants(t, 2)).toEqual([
		{ vendor: "Croma", amount: 9999, count: 1, category: "Shopping" },
		{ vendor: "Swiggy", amount: 500, count: 2, category: "Food" },
	]);
});

test("monthlyTotals: oldest first, current month included, empty months are zero", () => {
	const t = [tx("1", "a", "2026-10-02", 100), tx("2", "b", "2026-08-15", 50), tx("3", "c", "2026-08-01", 25), tx("4", "d", "2026-04-01", 999)];
	const out = monthlyTotals(t, new Date(2026, 9, 22), 3);
	expect(out.map((m) => [ymd(m.month), m.total])).toEqual([["2026-08-01", 75], ["2026-09-01", 0], ["2026-10-01", 100]]);
});

test("needsCategory counts rows with no real category", () => {
	expect(needsCategory([tx("1", "a", "2026-10-02", 1, null), tx("2", "a", "2026-10-02", 1, ""), tx("3", "a", "2026-10-02", 1, "Other"), tx("4", "a", "2026-10-02", 1, "Uncategorised"), tx("5", "a", "2026-10-02", 1, "Food")])).toBe(4);
});
