// Node-only unit tests (no browser) for the Home calculations.
import { test, expect } from "@playwright/test";
import {
	briefSentence,
	fill,
	suggestedQuestions,
	cumulative,
	heat,
	periods,
	relativeTime,
	sameDayDelta,
	type Txn,
} from "../src/lib/home-math";

const d = (s: string) => {
	const [y, m, day] = s.split("-").map(Number);
	return new Date(y, m - 1, day);
};
const iso = (x: Date) =>
	`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const txn = (date: string, total_amount: number | null): Txn => ({
	id: date + total_amount,
	vendor_name: "V",
	date,
	total_amount,
	category: null,
	created_at: null,
});
const money = (n: number) => "₹" + n.toLocaleString("en-IN");
const today = d("2026-10-20");

test("periods 1M on Oct 20 is Oct 1..31 vs Sep 1..30", () => {
	const { current, previous } = periods("1M", today);
	expect([iso(current.start), iso(current.end), current.days]).toEqual(["2026-10-01", "2026-10-31", 31]);
	expect([iso(previous.start), iso(previous.end), previous.days]).toEqual(["2026-09-01", "2026-09-30", 30]);
});

test("periods 1W uses Monday weeks", () => {
	const { current, previous } = periods("1W", today); // 2026-10-20 is a Tuesday
	expect([iso(current.start), iso(current.end), current.days]).toEqual(["2026-10-19", "2026-10-25", 7]);
	expect([iso(previous.start), iso(previous.end)]).toEqual(["2026-10-12", "2026-10-18"]);
});

test("periods 3M and YTD", () => {
	const q = periods("3M", today);
	expect([iso(q.current.start), iso(q.current.end), iso(q.previous.start), iso(q.previous.end)]).toEqual([
		"2026-08-01",
		"2026-10-31",
		"2026-05-01",
		"2026-07-31",
	]);
	const y = periods("YTD", today);
	expect([iso(y.current.start), iso(y.current.end), y.current.days, iso(y.previous.start)]).toEqual([
		"2026-01-01",
		"2026-12-31",
		365,
		"2025-01-01",
	]);
});

test("cumulative sums by day and ignores out-of-period and null amounts", () => {
	const { current } = periods("1M", today);
	const c = cumulative([txn("2026-10-01", 100), txn("2026-10-03", 50), txn("2026-09-30", 999), txn("2026-10-03", null)], current);
	expect(c.length).toBe(31);
	expect(c.slice(0, 4)).toEqual([100, 100, 150, 150]);
	expect(c[30]).toBe(150);
});

test("same-day comparison clamps to previous month length", () => {
	const cur = Array.from({ length: 31 }, (_, i) => (i + 1) * 10);
	const prev = Array.from({ length: 30 }, (_, i) => (i + 1) * 20);
	expect(sameDayDelta(cur, prev, 30)).toEqual({ abs: 310 - 600, pct: ((310 - 600) / 600) * 100 });
});

test("sameDayDelta is null when previous is 0", () => {
	expect(sameDayDelta([5, 10], [0, 0], 1)).toBeNull();
});

const base = { monthName: "October", prevMonthName: "September", money, today };

test("brief lighter", () => {
	expect(briefSentence({ ...base, spent: 18412, delta: { pct: -9.2 } })).toBe(
		"October is running 9% lighter than September.",
	);
});

test("brief heavier with next bill", () => {
	expect(
		briefSentence({ ...base, spent: 18412, delta: { pct: 12 }, nextBill: { vendor: "Netflix", date: d("2026-10-23") } }),
	).toBe("October is running 12% heavier than September. Netflix renews on Friday.");
});

test("brief with no data", () => {
	expect(briefSentence({ ...base, spent: 0, delta: null })).toBe("Nothing spent yet in October.");
});

test("brief with no comparison", () => {
	expect(briefSentence({ ...base, spent: 18412, delta: null })).toBe("You've spent ₹18,412 so far in October.");
});

test("next bill more than 6 days out uses a date", () => {
	expect(
		briefSentence({ ...base, spent: 18412, delta: null, nextBill: { vendor: "Rent", date: d("2026-11-01") } }),
	).toBe("You've spent ₹18,412 so far in October. Rent renews on 1 Nov.");
});

test("heat", () => {
	expect(heat(0, 100)).toBe(0);
	expect(heat(100, 100)).toBe(0.85);
	expect(heat(1, 100)).toBeGreaterThanOrEqual(0.15);
});

test("relativeTime", () => {
	const now = new Date(2026, 9, 20, 12, 0, 0);
	const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
	expect(relativeTime(ago(30_000), now)).toBe("just now");
	expect(relativeTime(ago(5 * 60_000), now)).toBe("5m ago");
	expect(relativeTime(ago(2 * 3_600_000), now)).toBe("2h ago");
	expect(relativeTime(ago(3 * 86_400_000), now)).toBe("3d ago");
	expect(relativeTime(ago(10 * 86_400_000), now)).toBe("10 Oct");
});

test("relativeTime treats offset-less backend timestamps as UTC", () => {
	const now = new Date(Date.UTC(2026, 9, 20, 12, 0, 0));
	expect(relativeTime("2026-10-20T10:00:00", now)).toBe("2h ago"); // backend: datetime.utcnow().isoformat()
	expect(relativeTime("2026-10-20T10:00:00Z", now)).toBe("2h ago");
	expect(relativeTime("2026-10-20T15:30:00+05:30", now)).toBe("2h ago");
});

test("fill replaces placeholders with money", () => {
	expect(fill("{0} so far vs {1} by this point last month.", [6750, 5000], money)).toBe(
		"₹6,750 so far vs ₹5,000 by this point last month.",
	);
	expect(fill("No amounts here", [], money)).toBe("No amounts here");
});

test("sameDayDelta guards a non-positive previous total", () => {
	expect(sameDayDelta([5], [-10], 0)).toBeNull();
});

test("suggestedQuestions maps found items, dedupes, caps at 4", () => {
	const f = (kind: string, subject: string | null) => ({ kind, subject }) as never;
	expect(
		suggestedQuestions(
			[f("duplicate", "Croma"), f("spike", "Food"), f("price_rise", "Spotify"), f("review", null)],
			["Why is Food up this month?", "Which vendor did I spend the most with?"],
		),
	).toEqual([
		"Was I charged twice at Croma?",
		"Why is Food up this month?",
		"Which of my subscriptions went up?",
		"Which vendor did I spend the most with?",
	]);
	expect(suggestedQuestions([], ["A", "B"])).toEqual(["A", "B"]);
});
