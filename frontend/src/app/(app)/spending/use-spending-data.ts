"use client";

import { useCallback, useEffect, useState } from "react";
import { homeApi, type HomeSummary } from "@/lib/api/client";
import type { Txn } from "@/lib/home-math";
import { spendPeriods, type Choice } from "@/lib/spending-math";
import { fetchTxns } from "../home/use-home-data";

export type SpendingData = {
	status: "loading" | "ready";
	txns: Txn[];
	prevTxns: Txn[];
	/** the last six calendar months, for the month-by-month bars */
	recent: Txn[];
	summary: HomeSummary | null;
	/** swap one row in place after its category is edited */
	patch: (id: Txn["id"], change: Partial<Txn>) => void;
};

const value = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === "fulfilled" ? r.value : fallback);

// Spending's data, from endpoints that exist today (spec 2026-10-22 §4.2). Like Home: the period's rows reload when the
// choice changes but the old numbers stay until the new ones arrive, so a click never blanks the page; the six-month
// history and the findings load once. A failed call empties only its card.
export function useSpendingData(choice: Choice, today: Date): SpendingData {
	const [rows, setRows] = useState<{ txns: Txn[]; prevTxns: Txn[] } | null>(null);
	const [recent, setRecent] = useState<Txn[] | null>(null);
	const [summary, setSummary] = useState<HomeSummary | null>(null);
	const key = typeof choice === "object" ? `${choice.from.toDateString()}-${choice.to.toDateString()}` : choice;
	const day = today.toDateString();

	useEffect(() => {
		let live = true;
		const { current, previous } = spendPeriods(choice, today);
		Promise.allSettled([fetchTxns(current.start, current.end), fetchTxns(previous.start, previous.end)]).then(([cur, prev]) => {
			if (live) setRows({ txns: value(cur, []), prevTxns: value(prev, []) });
		});
		return () => {
			live = false;
		};
		// choice is a fresh object for custom ranges; its key is what matters
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, day]);

	useEffect(() => {
		let live = true;
		Promise.allSettled([
			fetchTxns(new Date(today.getFullYear(), today.getMonth() - 5, 1), new Date(today.getFullYear(), today.getMonth() + 1, 0)),
			homeApi.summary(),
		]).then(([six, found]) => {
			if (!live) return;
			setRecent(value(six, []));
			setSummary(value(found, null));
		});
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [day]);

	const patch = useCallback((id: Txn["id"], change: Partial<Txn>) => {
		const swap = (list: Txn[]) => list.map((t) => (t.id === id ? { ...t, ...change } : t));
		setRows((r) => (r ? { txns: swap(r.txns), prevTxns: r.prevTxns } : r));
		setRecent((r) => (r ? swap(r) : r));
	}, []);

	return {
		status: rows && recent ? "ready" : "loading",
		txns: rows?.txns ?? [],
		prevTxns: rows?.prevTxns ?? [],
		recent: recent ?? [],
		summary,
		patch,
	};
}
