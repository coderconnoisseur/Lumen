"use client";

import { useEffect, useState } from "react";
import { billsApi, forecastApi, budgetApi, homeApi, transactionApi, type BudgetState, type ForecastData, type HomeSummary, type RecurringItem } from "@/lib/api/client";
import { parseDay, periods, type Range, type Txn } from "@/lib/home-math";

export type Reminder = { id: string | number; vendor: string; amount: number | null; date: string; type: string; category?: string };
import { toBills } from "@/lib/bills-math";
export type Forecast = ForecastData | null;
export type HomeData = {
	status: "loading" | "ready";
	txns: Txn[];
	prevTxns: Txn[];
	monthTxns: Txn[];
	prevMonthTxns: Txn[];
	reminders: Reminder[];
	forecast: Forecast;
	summary: HomeSummary | null;
	budget: BudgetState | null;
};

const ymd = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The API returns at most 100 rows a page, so follow has_next; a period's totals need every row.
// ponytail: client-side paging, capped at 50 pages (5,000 rows); Phase 3's summary endpoint sums on the server.
export async function fetchTxns(from: Date, to: Date): Promise<Txn[]> {
	const rows: Txn[] = [];
	for (let page = 1; page <= 50; page++) {
		const r: { data?: Txn[]; pagination?: { has_next?: boolean } } = await transactionApi.getTransactions({
			date_from: ymd(from),
			date_to: ymd(to),
			page,
			page_size: 100,
			sort_by: "date",
			sort_order: "desc",
		});
		rows.push(...(r.data ?? []));
		if (!r.pagination?.has_next) break;
	}
	return rows;
}
const value = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === "fulfilled" ? r.value : fallback);

// Everything Home shows, from endpoints that exist today (Phase 3 swaps parts of this for a summary endpoint).
// A failed call empties its card instead of breaking the page. Three independent loads:
//  - transactions, per chart range (skeletons only on the very first load; later range changes keep the old
//    numbers until the new ones arrive, so a click on the chart never blanks the brief or another card)
//  - reminders, the Home summary (Lumen found + activity) and the budget, once
//  - the forecast, once, numbers only (no LLM text); it never holds up the page, the dotted line just appears
type Txns = Pick<HomeData, "txns" | "prevTxns" | "monthTxns" | "prevMonthTxns">;
type Extras = Pick<HomeData, "reminders" | "summary" | "budget">;

export function useHomeData(range: Range, today: Date): HomeData {
	const [txns, setTxns] = useState<Txns | null>(null);
	const [extras, setExtras] = useState<Extras | null>(null);
	const [forecast, setForecast] = useState<Forecast>(null);
	const day = today.toDateString();

	useEffect(() => {
		let live = true;
		const { current, previous } = periods(range, today);
		// the brief and calendar are always about this calendar month, whatever range the chart shows
		const month = periods("1M", today);
		Promise.allSettled([
			fetchTxns(current.start, current.end),
			fetchTxns(previous.start, previous.end),
			range === "1M" ? Promise.resolve(null) : fetchTxns(month.current.start, month.current.end),
			range === "1M" ? Promise.resolve(null) : fetchTxns(month.previous.start, month.previous.end),
		]).then(([cur, prev, monthCur, monthPrev]) => {
			if (!live) return;
			const t = value(cur, []);
			const p = value(prev, []);
			setTxns({ txns: t, prevTxns: p, monthTxns: value(monthCur, null) ?? t, prevMonthTxns: value(monthPrev, null) ?? p });
		});
		return () => {
			live = false;
		};
		// today is a fresh Date each render; the day is what matters
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [range, day]);

	useEffect(() => {
		let live = true;
		Promise.allSettled([
			billsApi.recurring().then((r) => toBills(r.items, today)),
			homeApi.summary(),
			budgetApi.get(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`),
		]).then(([reminders, summary, budget]) => {
			if (live) setExtras({ reminders: value(reminders, []), summary: value(summary, null), budget: value(budget, null) });
		});
		forecastApi.get(ymd(today)).then((f) => live && setForecast(f), () => {});
		return () => {
			live = false;
		};
		// today is a fresh Date each render; the day is what matters
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [day]);

	return {
		status: txns && extras ? "ready" : "loading",
		txns: txns?.txns ?? [],
		prevTxns: txns?.prevTxns ?? [],
		monthTxns: txns?.monthTxns ?? [],
		prevMonthTxns: txns?.prevMonthTxns ?? [],
		reminders: extras?.reminders ?? [],
		summary: extras?.summary ?? null,
		budget: extras?.budget ?? null,
		forecast,
	};
}
