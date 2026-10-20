"use client";

import { useEffect, useState } from "react";
import { aiAnalyticsApi, reviewApi, transactionApi } from "@/lib/api/client";
import { periods, type Range, type Txn } from "@/lib/home-math";

export type Reminder = { id: string | number; vendor: string; amount: number | null; date: string; type: string; category?: string };
export type Forecast = { dates: string[]; values: number[] } | null;
export type HomeData = {
	status: "loading" | "ready";
	txns: Txn[];
	prevTxns: Txn[];
	monthTxns: Txn[];
	prevMonthTxns: Txn[];
	reminders: Reminder[];
	forecast: Forecast;
	toReview: number;
};

const ymd = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fetchTxns = (from: Date, to: Date) =>
	transactionApi
		.getTransactions({ date_from: ymd(from), date_to: ymd(to), page_size: 500, sort_by: "date", sort_order: "desc" })
		.then((r: { data?: Txn[] }) => r.data ?? []);
const value = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === "fulfilled" ? r.value : fallback);

// Everything Home shows, from endpoints that exist today (Phase 3 swaps parts of this for a summary endpoint).
// A failed call empties its card instead of breaking the page.
export function useHomeData(range: Range, today: Date): HomeData {
	const [data, setData] = useState<HomeData>({
		status: "loading",
		txns: [],
		prevTxns: [],
		monthTxns: [],
		prevMonthTxns: [],
		reminders: [],
		forecast: null,
		toReview: 0,
	});

	useEffect(() => {
		let live = true;
		const { current, previous } = periods(range, today);
		// the brief and calendar are always about this calendar month, whatever range the chart shows
		const month = periods("1M", today);
		// skeletons only on the first load; a range change keeps the old numbers until the new ones arrive
		// (a click on the chart must not blank the brief or any other card)
		Promise.allSettled([
			fetchTxns(current.start, current.end),
			fetchTxns(previous.start, previous.end),
			range === "1M" ? Promise.resolve(null) : fetchTxns(month.current.start, month.current.end),
			range === "1M" ? Promise.resolve(null) : fetchTxns(month.previous.start, month.previous.end),
			aiAnalyticsApi.getReminders(31).then((r: { reminders?: Reminder[] }) => r.reminders ?? []),
			aiAnalyticsApi
				.getForecast(31)
				.then((r: { forecast?: { success?: boolean; forecast?: Forecast } }) =>
					r.forecast?.success === false ? null : (r.forecast?.forecast ?? null),
				),
			reviewApi.list().then((items) => items.length),
		]).then(([cur, prev, monthCur, monthPrev, reminders, forecast, toReview]) => {
			if (!live) return;
			const txns = value(cur, []);
			const prevTxns = value(prev, []);
			setData({
				status: "ready",
				txns,
				prevTxns,
				monthTxns: value(monthCur, null) ?? txns,
				prevMonthTxns: value(monthPrev, null) ?? prevTxns,
				reminders: value(reminders, []),
				forecast: value(forecast, null),
				toReview: value(toReview, 0),
			});
		});
		return () => {
			live = false;
		};
		// today is a fresh Date each render; the day is what matters
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [range, today.toDateString()]);

	return data;
}
