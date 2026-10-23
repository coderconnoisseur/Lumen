// Pure calculations behind the Bills page (UI revamp Phase 5c). No React, no fetching; unit tests in
// e2e/bills-math.spec.ts. Input is GET /api/bills/recurring's items.
import type { RecurringItem } from "@/lib/api/client";
import { parseDay } from "@/lib/home-math";

const DAY = 86_400_000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// still being charged: not cancelled (a "charged again" one is) and not looking stopped
const live = (i: RecurringItem) => i.state !== "cancelled" && !i.possibly_stopped;

export function monthlyEquivalent(i: RecurringItem): number {
	return i.cadence === "weekly" ? (i.typical_amount * 52) / 12 : i.cadence === "yearly" ? i.typical_amount / 12 : i.typical_amount;
}

// The days of `month` (0-based) a charge is expected on, projected from its next due date by its cadence.
export function dueDays(i: RecurringItem, year: number, month: number): number[] {
	const next = parseDay(i.next_due_date);
	const last = new Date(year, month + 1, 0).getDate();
	if (i.cadence === "monthly") return [Math.min(next.getDate(), last)];
	if (i.cadence === "yearly") return next.getMonth() === month ? [next.getDate()] : [];
	const first = new Date(year, month, 1);
	const offset = ((Math.round((next.getTime() - first.getTime()) / DAY) % 7) + 7) % 7;
	const out: number[] = [];
	for (let d = 1 + offset; d <= last; d += 7) out.push(d);
	return out;
}

type Due = { vendor: string; date: Date; amount: number; item: RecurringItem; late?: boolean };

// Every expected charge from today to 30 days out (weekly ones more than once), soonest first. A charge whose expected
// date has passed without being seen is still coming (bills drift, statements arrive in batches), so it's kept, marked
// late, until the detection calls it stopped.
function dueSoon(items: RecurringItem[], today: Date): Due[] {
	const until = addDays(today, 30);
	const out: Due[] = [];
	for (const i of items.filter(live)) {
		const first = parseDay(i.next_due_date);
		if (first < today) out.push({ vendor: i.vendor, date: first, amount: i.typical_amount, item: i, late: true });
		const step = i.cadence === "weekly" ? 7 : null;
		for (let d = first; d <= until; d = step ? addDays(d, step) : addDays(until, 1))
			if (d >= today) out.push({ vendor: i.vendor, date: d, amount: i.typical_amount, item: i });
	}
	return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// Home's "Coming up": the same charges for the next month, late ones first, in Home's reminder shape.
export function toBills(items: RecurringItem[], today: Date) {
	return dueSoon(items, today).map((d) => ({
		id: `${d.vendor}-${d.date.toDateString()}`, vendor: d.vendor, amount: d.amount, date: ymd(d.date),
		type: d.late ? "late" : "upcoming", category: d.item.category ?? undefined,
	}));
}

// Not seen yet (late), then the next 30 days as This week (to Sunday), Next week and Later, each with its total;
// empty groups are left out.
export function upcoming(items: RecurringItem[], today: Date): { label: string; rows: Due[]; total: number }[] {
	const sunday = addDays(today, 6 - ((today.getDay() + 6) % 7));
	const nextSunday = addDays(sunday, 7);
	const groups = [
		{ label: "Not seen yet", rows: [] as Due[] },
		{ label: "This week", rows: [] as Due[] },
		{ label: "Next week", rows: [] as Due[] },
		{ label: "Later", rows: [] as Due[] },
	];
	for (const d of dueSoon(items, today)) groups[d.late ? 0 : d.date <= sunday ? 1 : d.date <= nextSunday ? 2 : 3].rows.push(d);
	return groups.filter((g) => g.rows.length).map((g) => ({ ...g, total: g.rows.reduce((s, r) => s + r.amount, 0) }));
}

export function tiles(items: RecurringItem[], today: Date) {
	const soon = dueSoon(items, today);
	const stopped = items.filter((i) => i.possibly_stopped && i.kind === "subscription" && i.state !== "cancelled");
	return {
		dueSoon: { total: soon.reduce((s, d) => s + d.amount, 0), count: soon.length },
		perMonth: Math.round(items.filter(live).reduce((s, i) => s + monthlyEquivalent(i), 0)),
		stopped: { count: stopped.length, perMonth: Math.round(stopped.reduce((s, i) => s + monthlyEquivalent(i), 0)) },
	};
}

// The calendar's bills for a month: an item shows from its first known charge on (estimated back from the last one by
// its cadence and count), and one that's cancelled or looks stopped only up to the month of its last charge.
export function billsOnCalendar(items: RecurringItem[], year: number, month: number): Map<number, RecurringItem[]> {
	const out = new Map<number, RecurringItem[]>();
	const shown = year * 12 + month;
	for (const i of items) {
		const last = parseDay(i.last_charge_date);
		const back = i.charges_count - 1;
		const first =
			i.cadence === "weekly" ? addDays(last, -7 * back) : i.cadence === "yearly" ? new Date(last.getFullYear() - back, last.getMonth(), 1) : new Date(last.getFullYear(), last.getMonth() - back, 1);
		const ended = i.state === "cancelled" || i.possibly_stopped;
		if (shown < first.getFullYear() * 12 + first.getMonth() || (ended && shown > last.getFullYear() * 12 + last.getMonth())) continue;
		for (const d of dueDays(i, year, month)) out.set(d, [...(out.get(d) ?? []), i]);
	}
	return out;
}

// The brief's first sentence, about the soonest charge. A weekday name alone is only safe within the next six days
// ("Sunday" read on a Friday means the day after tomorrow, not the Sunday after); past that it gives the date.
export function nextBillSentence(groups: ReturnType<typeof upcoming>, today: Date, money: (n: number) => string): string | null {
	const next = groups[0]?.rows[0];
	if (!next) return null;
	const who = `${next.vendor} (${money(next.amount)})`;
	const days = Math.round((next.date.getTime() - today.getTime()) / DAY);
	if (next.late) return `${who} was expected on ${next.date.toLocaleString("en-GB", { day: "numeric", month: "short" })} and hasn't shown up yet.`;
	const when =
		days === 0 ? "today" : days === 1 ? "tomorrow" : days < 7 ? next.date.toLocaleString("en-US", { weekday: "long" }) : `on ${next.date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
	return `${who} is due ${when}.`;
}

// The small label over a date chip: the weekday this month, the month when it's another one ("Nov" over a 1 read in
// October would otherwise look like the 1st that has passed).
export const dateTag = (d: Date, today: Date) =>
	d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
		? d.toLocaleString("en-GB", { weekday: "short" })
		: d.toLocaleString("en-GB", { month: "short" });
