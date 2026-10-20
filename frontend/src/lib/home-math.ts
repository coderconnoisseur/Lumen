// Pure calculations behind the Home cards (UI revamp Phase 2). No React, no fetching, so they're unit-tested in
// e2e/home-math.spec.ts and can later be swapped for the Phase 3 summary endpoint. Dates are local, day-precision.

export type Txn = {
	id: string | number;
	vendor_name: string | null;
	date: string; // YYYY-MM-DD
	total_amount: number | null;
	category: string | null;
	created_at: string | null;
};
export type Range = "1W" | "1M" | "3M" | "YTD";
export type Period = { start: Date; end: Date; days: number }; // inclusive, local midnight

const DAY = 86_400_000;

export const parseDay = (s: string) => {
	const [y, m, d] = s.slice(0, 10).split("-").map(Number);
	return new Date(y, m - 1, d);
};
// round() absorbs the 23h/25h days around daylight-saving changes
export const dayIndex = (p: Period, day: Date) => Math.round((day.getTime() - p.start.getTime()) / DAY);

const period = (start: Date, end: Date): Period => ({ start, end, days: Math.round((end.getTime() - start.getTime()) / DAY) + 1 });
const months = (y: number, m: number, n: number) => period(new Date(y, m, 1), new Date(y, m + n, 0));

export function periods(range: Range, today: Date): { current: Period; previous: Period } {
	const y = today.getFullYear();
	const m = today.getMonth();
	switch (range) {
		case "1W": {
			const monday = new Date(y, m, today.getDate() - ((today.getDay() + 6) % 7));
			const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
			const prevMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
			const prevSunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1);
			return { current: period(monday, sunday), previous: period(prevMonday, prevSunday) };
		}
		case "1M":
			return { current: months(y, m, 1), previous: months(y, m - 1, 1) };
		case "3M":
			return { current: months(y, m - 2, 3), previous: months(y, m - 5, 3) };
		case "YTD":
			return { current: months(y, 0, 12), previous: months(y - 1, 0, 12) };
	}
}

export function cumulative(txns: Txn[], p: Period): number[] {
	const daily = new Array<number>(p.days).fill(0);
	for (const t of txns) {
		if (t.total_amount == null || !t.date) continue;
		const i = dayIndex(p, parseDay(t.date));
		if (i >= 0 && i < p.days) daily[i] += t.total_amount;
	}
	for (let i = 1; i < daily.length; i++) daily[i] += daily[i - 1];
	return daily;
}

export function sameDayDelta(cur: number[], prev: number[], index: number): { abs: number; pct: number } | null {
	if (!cur.length || !prev.length) return null;
	const now = cur[Math.min(index, cur.length - 1)];
	const then = prev[Math.min(index, prev.length - 1)];
	if (!then) return null;
	return { abs: now - then, pct: ((now - then) / then) * 100 };
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function briefSentence(a: {
	monthName: string;
	prevMonthName: string;
	spent: number;
	delta: { pct: number } | null;
	nextBill?: { vendor: string; date: Date };
	money: (n: number) => string;
	today: Date;
}): string {
	let s: string;
	if (a.spent <= 0) s = `Nothing spent yet in ${a.monthName}.`;
	else if (!a.delta) s = `You've spent ${a.money(Math.round(a.spent))} so far in ${a.monthName}.`;
	else {
		const pct = Math.round(Math.abs(a.delta.pct));
		s =
			pct === 0
				? `${a.monthName} is running level with ${a.prevMonthName}.`
				: `${a.monthName} is running ${pct}% ${a.delta.pct < 0 ? "lighter" : "heavier"} than ${a.prevMonthName}.`;
	}
	if (a.nextBill) {
		const inDays = Math.round((a.nextBill.date.getTime() - a.today.getTime()) / DAY);
		const when = inDays <= 6 ? WEEKDAY.format(a.nextBill.date) : DAY_MONTH.format(a.nextBill.date);
		s += ` ${a.nextBill.vendor} renews on ${when}.`;
	}
	return s;
}

export function calendarBuckets(txns: Txn[], p: Period): { day: number; amount: number }[] {
	const out = Array.from({ length: p.days }, (_, i) => ({ day: i + 1, amount: 0 }));
	for (const t of txns) {
		if (t.total_amount == null || !t.date) continue;
		const i = dayIndex(p, parseDay(t.date));
		if (i >= 0 && i < p.days) out[i].amount += t.total_amount;
	}
	return out;
}

export function heat(amount: number, max: number): number {
	if (amount <= 0 || max <= 0) return 0;
	return Math.min(0.15 + (amount / max) * 0.7, 0.85);
}

export function relativeTime(iso: string, now: Date): string {
	// the backend writes datetime.utcnow().isoformat(): UTC but with no offset, which JS would read as local time
	const at = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
	const s = Math.max(0, (now.getTime() - at.getTime()) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
	if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
	return DAY_MONTH.format(at);
}
