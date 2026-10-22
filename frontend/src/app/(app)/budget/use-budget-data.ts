"use client";

import { useCallback, useEffect, useState } from "react";
import { agentApi, budgetApi, type BudgetMonth, type BudgetState, type Proposal } from "@/lib/api/client";
import type { Txn } from "@/lib/home-math";
import { fetchTxns } from "../home/use-home-data";

export const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const value = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === "fulfilled" ? r.value : fallback);

export type BudgetData = {
	status: "loading" | "ready";
	budget: BudgetState | null;
	txns: Txn[];
	history: BudgetMonth[];
	/** set_budget proposals still waiting for a decision when the page opened */
	pending: Proposal[];
	/** after a save: replace the shown month's state */
	setBudget: (b: BudgetState) => void;
	/** after budget decisions: refetch this month's budget and the history */
	reload: () => void;
};

// The Budget page's data (spec 2026-10-22 §4.4). The shown month's budget and transactions reload when the month
// changes, keeping the old numbers until the new ones arrive (like Spending); history and pending draft lines load once.
export function useBudgetData(month: Date, today: Date): BudgetData {
	const [shown, setShown] = useState<{ budget: BudgetState | null; txns: Txn[] } | null>(null);
	const [once, setOnce] = useState<{ history: BudgetMonth[]; pending: Proposal[] } | null>(null);
	const key = ym(month);
	const day = today.toDateString();

	useEffect(() => {
		let live = true;
		const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
		Promise.allSettled([budgetApi.get(key === ym(today) ? undefined : key), fetchTxns(month, end < today ? end : today)]).then(([b, t]) => {
			if (live) setShown({ budget: value(b, null), txns: value(t, []) });
		});
		return () => {
			live = false;
		};
		// month is a fresh Date each render; its key is what matters
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, day]);

	useEffect(() => {
		let live = true;
		Promise.allSettled([budgetApi.history(6), agentApi.proposals()]).then(([h, p]) => {
			if (live) setOnce({ history: value(h, []), pending: value(p, []).filter((x) => x.type === "set_budget") });
		});
		return () => {
			live = false;
		};
	}, [day]);

	const setBudget = useCallback((budget: BudgetState) => setShown((s) => (s ? { ...s, budget } : s)), []);
	const reload = useCallback(() => {
		Promise.allSettled([budgetApi.get(), budgetApi.history(6)]).then(([b, h]) => {
			if (b.status === "fulfilled") setShown((s) => (s ? { ...s, budget: b.value } : s));
			if (h.status === "fulfilled") setOnce((o) => (o ? { ...o, history: h.value } : o));
		});
	}, []);

	return {
		status: shown && once ? "ready" : "loading",
		budget: shown?.budget ?? null,
		txns: shown?.txns ?? [],
		history: once?.history ?? [],
		pending: once?.pending ?? [],
		setBudget,
		reload,
	};
}
