// Pure calculations behind the Budget page (UI revamp Phase 5d). No React, no fetching; unit tests in
// e2e/budget-math.spec.ts.

const daysIn = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

// Where a month stands against its budget. The even-pace mark, days left, safe-per-day and the gap to an even pace
// only exist for the current month (null / 0 otherwise); safe-per-day is null once the budget is gone.
export function pace(total: number, spent: number, today: Date, month: Date) {
	const days = daysIn(month);
	const current = sameMonth(today, month);
	const evenPct = current ? today.getDate() / days : null;
	const left = total - spent;
	const daysLeft = current ? days - today.getDate() + 1 : 0;
	return {
		pct: total > 0 ? spent / total : 0,
		evenPct,
		left,
		daysLeft,
		perDay: current && left > 0 ? left / daysLeft : null,
		vsPace: evenPct === null ? null : spent - total * evenPct,
	};
}

export function usedTone(spent: number, limit: number): "good" | "warn" | "bad" {
	return spent > limit ? "bad" : spent >= limit * 0.9 ? "warn" : "good";
}

// The straight line from nothing to the whole budget on the last day, one value per day.
export const evenLine = (total: number, days: number) => Array.from({ length: days }, (_, i) => (total * (i + 1)) / days);

// This month's total if the rest of it goes like it has so far.
export const runRate = (spent: number, today: Date) => (spent / today.getDate()) * daysIn(today);
