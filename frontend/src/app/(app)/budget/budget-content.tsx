"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page/page-header";
import { Button } from "@/components/ui/button";
import { budgetApi } from "@/lib/api/client";
import { pace, usedTone } from "@/lib/budget-math";
import { useMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import { Brief } from "../home/_components/brief";
import { BudgetCategories } from "./_components/categories";
import { DraftPanel, type DraftLine } from "./_components/draft-panel";
import { BudgetHero } from "./_components/hero";
import { BudgetHistory } from "./_components/history";
import { useBudgetData, ym } from "./use-budget-data";

const monthYear = (d: Date) => d.toLocaleString("en-US", { month: "long", year: "numeric" });
const monthLong = (d: Date) => d.toLocaleString("en-US", { month: "long" });

// Budget (UI revamp Phase 5d, spec 2026-10-22 §4.4): am I on track, and what should my plan be? Budgets are saved per
// month, so past months are shown as they were and are read-only; edits and the draft apply from this month on.
// History sits above By category so the cards whose height depends on the data come last (no layout shift).
export default function BudgetContent() {
	const money = useMoney();
	const today = useMemo(() => {
		const n = new Date();
		return new Date(n.getFullYear(), n.getMonth(), n.getDate());
	}, []);
	const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
	const current = ym(month) === ym(today);
	const data = useBudgetData(month, today);
	const loading = data.status === "loading";
	const [editingTotal, setEditingTotal] = useState(false);
	const [lines, setLines] = useState<DraftLine[] | null>(null);
	const [draftKey, setDraftKey] = useState(0);
	const [drafting, setDrafting] = useState(false);
	const router = useRouter();
	const params = useSearchParams();
	const autoDraft = useRef(params.get("draft") === "1");

	// pending lines from an earlier draft show once loaded; ?draft=1 (Home's promo) files a fresh one on arrival
	useEffect(() => {
		if (loading || lines !== null) return;
		if (autoDraft.current) {
			autoDraft.current = false;
			router.replace("/budget", { scroll: false });
			void draft();
		} else if (data.pending.length) setLines(data.pending);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading]);

	async function draft() {
		setDrafting(true);
		try {
			setLines(await budgetApi.draft());
			setDraftKey((k) => k + 1);
		} catch {
			toast.error("Couldn't draft a budget right now.");
		} finally {
			setDrafting(false);
		}
	}

	async function save(body: Omit<Parameters<typeof budgetApi.put>[0], "month">) {
		try {
			data.setBudget(await budgetApi.put({ month: ym(today), ...body }));
			data.reload();
		} catch {
			toast.error("Couldn't save the budget.");
		}
	}

	const b = data.budget;
	const catSum = (b?.categories ?? []).reduce((s, c) => s + c.limit, 0);
	const total = b?.monthly_budget || catSum || null;
	const spent = b?.spent ?? 0;
	const brief = (() => {
		if (loading) return null;
		const overCats = (b?.categories ?? []).filter((c) => usedTone(c.spent, c.limit) === "bad").map((c) => c.category);
		const overText = overCats.length === 1 ? ` ${overCats[0]} is the one line over.` : overCats.length > 1 ? ` ${overCats.length} categories are over.` : "";
		if (total === null) return current ? `No budget yet. You've spent ${money(Math.round(spent))} this month; set one below or let Lumen draft it.` : `No budget for ${monthLong(month)}. You spent ${money(Math.round(spent))}.`;
		if (!current) return spent > total ? `${monthLong(month)} went ${money(Math.round(spent - total))} over its ${money(total)} budget.${overText}` : `${monthLong(month)} came in ${money(Math.round(total - spent))} under its ${money(total)} budget.${overText}`;
		if (spent > total) return `You're ${money(Math.round(spent - total))} over this month's budget.${overText}`;
		const p = pace(total, spent, today, month);
		return p.vsPace! <= 0 ? `You're on track: ${money(Math.round(-p.vsPace!))} under where an even pace would put you.${overText}` : `You're ${money(Math.round(p.vsPace!))} ahead of an even pace, with ${p.daysLeft} days to go.${overText}`;
	})();

	const step = (d: number) => {
		setEditingTotal(false);
		setMonth((m) => new Date(m.getFullYear(), m.getMonth() + d, 1));
	};
	const actions = (
		<>
			<div className="flex items-center rounded-[9px] border border-border/70 bg-card/70">
				<button type="button" aria-label="Previous month" onClick={() => step(-1)} className="p-1.5 text-muted-foreground hover:text-foreground">
					<ChevronLeft className="size-4" />
				</button>
				<span data-testid="month-label" className="label-ui w-32 text-center text-foreground">{monthYear(month)}</span>
				<button type="button" aria-label="Next month" disabled={current} onClick={() => step(1)} className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
					<ChevronRight className="size-4" />
				</button>
			</div>
			{current && (
				<>
					<Button variant="quiet" size="sm" className="rounded-full" onClick={() => setEditingTotal(true)} disabled={loading}>
						<Pencil /> Edit budget
					</Button>
					<Button variant="ink" size="sm" className="rounded-full" onClick={() => void draft()} disabled={loading || drafting}>
						<Sparkles /> Let Lumen draft
					</Button>
				</>
			)}
		</>
	);

	return (
		<div className="relative flex-1">
			<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[image:var(--band)]" />
			<div className="relative px-4 py-6 sm:px-6 lg:px-8">
				<PageHeader title="Budget" brief={<Brief text={brief} />} actions={actions} />
				<BudgetHero
					month={month}
					monthName={monthLong(month)}
					today={today}
					total={total}
					spent={spent}
					txns={data.txns}
					editing={editingTotal}
					onSave={(v) => {
						setEditingTotal(false);
						void save({ monthly_budget: v });
					}}
					onCancel={() => setEditingTotal(false)}
					loading={loading}
				/>
				<div className="mt-3.5">
					<BudgetHistory months={data.history} today={today} loading={loading} />
				</div>
				<div className={lines && current ? "mt-3.5 grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_400px]" : "mt-3.5"}>
					<BudgetCategories
						budget={b}
						total={total}
						editable={current}
						onSet={(category, limit) => save({ categories: [{ category, limit }] })}
						loading={loading}
					/>
					{lines && current && (
						<DraftPanel key={draftKey} lines={lines} setLines={setLines} budget={b} monthName={monthLong(today)} onDecided={data.reload} />
					)}
				</div>
			</div>
		</div>
	);
}
