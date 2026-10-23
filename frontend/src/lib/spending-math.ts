// Pure calculations behind the Spending page (UI revamp Phase 5b). No React, no fetching; unit tests in
// e2e/spending-math.spec.ts. Built on the same Period/Txn shapes as Home (lib/home-math.ts).
import { period, periods, type Period, type Txn } from "@/lib/home-math";

export type Choice = "this-month" | "last-month" | "3M" | "YTD" | { from: Date; to: Date };

const longMonth = (d: Date) => d.toLocaleString("en-US", { month: "long" });
const shortMonth = (d: Date) => d.toLocaleString("en-US", { month: "short" });
const dayMonth = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short" });
const UNCATEGORISED = "Uncategorised";

// The period a choice covers and the one it's compared with (the same length, immediately before), with labels.
export function spendPeriods(choice: Choice, today: Date): { current: Period; previous: Period; label: string; prevLabel: string } {
	const y = today.getFullYear();
	const m = today.getMonth();
	if (typeof choice === "object") {
		// a date typed past the other input's limit can arrive backwards; read it forwards rather than as -n days
		const [from, to] = choice.from <= choice.to ? [choice.from, choice.to] : [choice.to, choice.from];
		const current = period(from, to);
		const prevEnd = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
		const previous = period(new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() - current.days + 1), prevEnd);
		return { current, previous, label: `${dayMonth(current.start)} – ${dayMonth(current.end)}`, prevLabel: "the days before" };
	}
	if (choice === "last-month") {
		const current = period(new Date(y, m - 1, 1), new Date(y, m, 0));
		const previous = period(new Date(y, m - 2, 1), new Date(y, m - 1, 0));
		return { current, previous, label: longMonth(current.start), prevLabel: longMonth(previous.start) };
	}
	const p = periods(choice === "this-month" ? "1M" : choice, today);
	if (choice === "YTD") return { ...p, label: String(y), prevLabel: String(y - 1) };
	if (choice === "3M")
		return { ...p, label: `${shortMonth(p.current.start)} – ${shortMonth(p.current.end)}`, prevLabel: `${shortMonth(p.previous.start)} – ${shortMonth(p.previous.end)}` };
	return { ...p, label: longMonth(p.current.start), prevLabel: longMonth(p.previous.start) };
}

const sumBy = (txns: Txn[], key: (t: Txn) => string) => {
	const out = new Map<string, number>();
	for (const t of txns) if (t.total_amount != null) out.set(key(t), (out.get(key(t)) ?? 0) + t.total_amount);
	return out;
};
const categoryOf = (t: Txn) => t.category || UNCATEGORISED;

// Each category's spend this period, its share of the total and the change against the previous period.
export function byCategory(cur: Txn[], prev: Txn[]): { category: string; amount: number; share: number; change: number }[] {
	const now = sumBy(cur, categoryOf);
	const before = sumBy(prev, categoryOf);
	const total = [...now.values()].reduce((a, b) => a + b, 0);
	return [...now.entries()]
		.map(([category, amount]) => ({ category, amount, share: total ? amount / total : 0, change: amount - (before.get(category) ?? 0) }))
		.sort((a, b) => b.amount - a.amount);
}

export function topMerchants(txns: Txn[], n: number): { vendor: string; amount: number; count: number; category: string | null }[] {
	const out = new Map<string, { vendor: string; amount: number; count: number; category: string | null }>();
	for (const t of txns) {
		if (!t.vendor_name || t.total_amount == null) continue;
		const row = out.get(t.vendor_name) ?? { vendor: t.vendor_name, amount: 0, count: 0, category: t.category };
		row.amount += t.total_amount;
		row.count += 1;
		out.set(t.vendor_name, row);
	}
	return [...out.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

// The last `months` calendar months, oldest first, ending with the current one.
export function monthlyTotals(txns: Txn[], today: Date, months: number): { month: Date; total: number }[] {
	const out = Array.from({ length: months }, (_, i) => ({ month: new Date(today.getFullYear(), today.getMonth() - months + 1 + i, 1), total: 0 }));
	for (const t of txns) {
		if (t.total_amount == null || !t.date) continue;
		const [yy, mm] = t.date.split("-").map(Number);
		const row = out.find((o) => o.month.getFullYear() === yy && o.month.getMonth() === mm - 1);
		if (row) row.total += t.total_amount;
	}
	return out;
}

export const needsCategory = (txns: Txn[]) =>
	txns.filter((t) => !t.category || t.category === "Other" || t.category === UNCATEGORISED).length;

export const sourceOf = (t: Txn) => (t.source === "statement" ? "Statement" : "Receipt");

// One CSV cell. Vendor names come from bank lines and emailed invoices, so text a spreadsheet would run as a formula
// (=, +, -, @, tab or CR first) gets a leading ' to stay text; amounts are numbers and stay as they are.
const cell = (v: string | number) => {
	const s = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV of exactly the rows shown (spec 2026-10-22 §4.2): date, merchant, category, source, amount.
export const toCsv = (rows: Txn[]) =>
	["date,merchant,category,source,amount", ...rows.map((t) => [t.date, t.vendor_name ?? "", t.category ?? "", sourceOf(t), t.total_amount ?? 0].map(cell).join(","))].join("\n");

const SORT_LATER = new Set(["", "other", "uncategorised"]);
// Whether a row belongs to a category, ignoring case and spaces: links (Home's spike, ?category=) carry the most common
// spelling, rows may use another. "Uncategorised" also covers blank and "Other".
export const inCategory = (t: Txn, c: string) => {
	const mine = (t.category ?? "").trim().toLowerCase();
	const want = c.trim().toLowerCase();
	return want === "uncategorised" ? SORT_LATER.has(mine) : mine === want;
};
