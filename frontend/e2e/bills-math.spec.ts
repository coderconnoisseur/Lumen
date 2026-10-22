// Node-only unit tests (no browser) for the Bills page's calculations (UI revamp Phase 5c).
import { test, expect } from "@playwright/test";
import { dueDays, monthlyEquivalent, tiles, toBills, upcoming } from "../src/lib/bills-math";
import type { RecurringItem } from "../src/lib/api/client";

const item = (vendor: string, cadence: RecurringItem["cadence"], next: string, amount: number, extra: Partial<RecurringItem> = {}): RecurringItem => ({
	vendor, category: "Bills", cadence, typical_amount: amount, last_charge_date: "2026-09-24", next_due_date: next,
	charges_count: 3, price_change: null, kind: "bill", possibly_stopped: false, state: "active", ...extra,
});
const today = new Date(2026, 9, 22); // Thu 22 Oct 2026

test("monthlyEquivalent spreads weekly and yearly charges per month", () => {
	expect(monthlyEquivalent(item("Rent", "monthly", "2026-10-24", 25000))).toBe(25000);
	expect(monthlyEquivalent(item("Maid", "weekly", "2026-10-24", 1200))).toBe(5200);
	expect(monthlyEquivalent(item("Prime", "yearly", "2026-11-14", 1500))).toBe(125);
});

test("dueDays projects each cadence onto a month", () => {
	expect(dueDays(item("Rent", "monthly", "2026-10-24", 1), 2026, 9)).toEqual([24]);
	expect(dueDays(item("Rent", "monthly", "2026-10-24", 1), 2026, 10)).toEqual([24]);
	expect(dueDays(item("Gym", "monthly", "2026-10-31", 1), 2026, 10)).toEqual([30]); // November has 30 days
	expect(dueDays(item("Maid", "weekly", "2026-10-24", 1), 2026, 9)).toEqual([3, 10, 17, 24, 31]);
	expect(dueDays(item("Prime", "yearly", "2026-11-14", 1), 2026, 10)).toEqual([14]);
	expect(dueDays(item("Prime", "yearly", "2026-11-14", 1), 2026, 9)).toEqual([]);
});

test("upcoming groups the next 30 days into this week, next week and later", () => {
	const g = upcoming([item("Rent", "monthly", "2026-10-24", 25000), item("Jio", "monthly", "2026-10-27", 999), item("Netflix", "monthly", "2026-11-12", 649), item("Old", "monthly", "2026-12-30", 5)], today);
	expect(g.map((x) => [x.label, x.rows.map((r) => r.vendor), x.total])).toEqual([
		["This week", ["Rent"], 25000],
		["Next week", ["Jio"], 999],
		["Later", ["Netflix"], 649],
	]);
});

test("tiles: due soon, recurring per month, and subscriptions that look stopped", () => {
	const t = tiles([
		item("Rent", "monthly", "2026-10-24", 25000),
		item("Prime", "yearly", "2027-03-14", 1500, { kind: "subscription" }),
		item("Spotify", "monthly", "2026-08-02", 119, { kind: "subscription", possibly_stopped: true }),
		item("Gym", "monthly", "2026-10-30", 1500, { state: "cancelled" }),
	], today);
	expect(t.dueSoon).toEqual({ total: 25000, count: 1 });
	expect(t.perMonth).toBe(25125); // rent + prime/12; stopped and cancelled ones don't count
	expect(t.stopped).toEqual({ count: 1, perMonth: 119 });
});

test("a bill that's late but not stopped stays on the list as not seen yet", () => {
	const late = item("Power", "monthly", "2026-10-18", 1800);
	expect(upcoming([late, item("Rent", "monthly", "2026-10-24", 25000)], today).map((g) => [g.label, g.rows.map((r) => r.vendor)])).toEqual([
		["Not seen yet", ["Power"]],
		["This week", ["Rent"]],
	]);
	expect(tiles([late], today).dueSoon).toEqual({ total: 1800, count: 1 });
});

test("toBills: Home keeps late and charged-again bills, drops cancelled and stopped ones", () => {
	const bills = toBills([
		item("Power", "monthly", "2026-10-18", 1800),
		item("Netflix", "monthly", "2026-10-30", 649, { state: "charged_again" }),
		item("Gym", "monthly", "2026-10-28", 1500, { state: "cancelled" }),
		item("Spotify", "monthly", "2026-08-02", 119, { possibly_stopped: true }),
		item("Far", "monthly", "2026-12-30", 5),
	], today);
	expect(bills.map((b) => b.vendor)).toEqual(["Power", "Netflix"]);
});
