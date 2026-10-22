"use client";

import { useCallback, useEffect, useState } from "react";
import { aiAnalyticsApi, budgetApi, homeApi, transactionApi, type BudgetState, type HomeSummary } from "@/lib/api/client";
import { periods, type Range, type Txn } from "@/lib/home-math";

export type Reminder = { id: string | number; vendor: string; amount: number | null; date: string; type: string; category?: string };
// GET /api/analytics/reminders as the backend sends it (ai/pattern_detection.generate_reminders).
type ApiReminder = {
	title?: string;
	predicted_date?: string | null;
	pattern_id?: string | number;
	metadata?: { vendor_name?: string | null; average_amount?: number | null; category?: string | null } | null;
};
// Bills only: a recurring payment to a vendor with a date. Restock nudges ("You usually buy Groceries around the
// 5th") have no vendor and aren't bills. Rows with no date are skipped rather than crashing the page.
export function toReminders(rows: ApiReminder[]): Reminder[] {
	return rows.flatMap((r, i) =>
		r.predicted_date && r.metadata?.vendor_name
			? [{
					id: r.pattern_id ?? i,
					vendor: r.metadata.vendor_name,
					amount: r.metadata.average_amount ?? null,
					date: r.predicted_date,
					type: "upcoming",
					category: r.metadata.category ?? undefined,
				}]
			: [],
	);
}
export type Forecast = { dates: string[]; values: number[] } | null;
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
	/** refetch the summary and the budget (after budget decisions) */
	reload: () => void;
};

const ymd = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The API returns at most 100 rows a page, so follow has_next; a period's totals need every row.
// ponytail: client-side paging, capped at 50 pages (5,000 rows); Phase 3's summary endpoint sums on the server.
async function fetchTxns(from: Date, to: Date): Promise<Txn[]> {
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
			aiAnalyticsApi.getReminders(31).then((r: { reminders?: ApiReminder[] }) => toReminders(r.reminders ?? [])),
			homeApi.summary(),
			budgetApi.get(),
		]).then(([reminders, summary, budget]) => {
			if (live) setExtras({ reminders: value(reminders, []), summary: value(summary, null), budget: value(budget, null) });
		});
		aiAnalyticsApi
			.getForecast(31, false)
			.then((r: { forecast?: { success?: boolean; forecast?: Forecast } }) =>
				r.forecast?.success === false ? null : (r.forecast?.forecast ?? null),
			)
			.then((f) => live && setForecast(f), () => {});
		return () => {
			live = false;
		};
	}, [day]);

	const reload = useCallback(() => {
		// decisions are POSTs, which already cleared the cached summary, so this refetches it
		Promise.allSettled([homeApi.summary(), budgetApi.get()]).then(([summary, budget]) =>
			setExtras((e) => (e ? { ...e, summary: value(summary, e.summary), budget: value(budget, e.budget) } : e)),
		);
	}, []);

	return {
		status: txns && extras ? "ready" : "loading",
		txns: txns?.txns ?? [],
		prevTxns: txns?.prevTxns ?? [],
		monthTxns: txns?.monthTxns ?? [],
		prevMonthTxns: txns?.prevMonthTxns ?? [],
		reminders: extras?.reminders ?? [],
		summary: extras?.summary ?? null,
		budget: extras?.budget ?? null,
		reload,
		forecast,
	};
}
