"use client";

import { useEffect, useRef, useState } from "react";
import { PageCard } from "@/components/page/page-card";
import type { BudgetState } from "@/lib/api/client";
import { usedTone } from "@/lib/budget-math";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE = { good: "bg-good", warn: "bg-amber-500", bad: "bg-bad" } as const;
const COLS = "grid grid-cols-[minmax(0,1.2fr)_76px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 sm:gap-3 sm:grid-cols-[minmax(0,1.3fr)_100px_90px_minmax(0,1fr)_minmax(0,1.4fr)]";

// By category (spec 2026-10-22 §4.4): budget, spent, left and a used bar per category. On the current month the
// budget amount is a button that turns into an input of the same height (Enter saves, Esc cancels), and new
// categories are added inline. Past months are read-only.
export function BudgetCategories({
	budget,
	total,
	editable,
	onSet,
	loading,
}: {
	budget: BudgetState | null;
	total: number | null;
	editable: boolean;
	onSet: (category: string, limit: number) => Promise<void>;
	loading: boolean;
}) {
	const money = useMoney();
	const [editing, setEditing] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const cats = budget?.categories ?? [];
	const sum = cats.reduce((s, c) => s + c.limit, 0);
	const over = cats.filter((c) => usedTone(c.spent, c.limit) === "bad").length;
	const close = cats.filter((c) => usedTone(c.spent, c.limit) === "warn").length;

	return (
		<PageCard
			title="By category"
			extra={
				<>
					{over > 0 && <span className="rounded-full bg-bad/10 px-2 py-0.5 text-bad normal-case">{over} over</span>}
					{close > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 normal-case">{close} close</span>}
				</>
			}
			loading={loading}
			skeletonHeight={180}
			data-testid="budget-categories"
		>
			{cats.length === 0 && !adding ? (
				<p className="py-6 text-center text-[13px] text-muted-foreground">
					No category budgets{editable ? " yet. Add one, or let Lumen draft them from your spending." : " this month."}
				</p>
			) : (
				<div className="text-[13px] tabular-nums">
					<div className={cn(COLS, "label-ui border-b border-border/70 pb-2 text-muted-foreground")}>
						<span>Category</span>
						<span>Budget</span>
						<span className="max-sm:hidden">Spent</span>
						<span>Left</span>
						<span>Used</span>
					</div>
					{cats.map((c) => {
						const tone = usedTone(c.spent, c.limit);
						const left = c.limit - c.spent;
						return (
							<div key={c.category} data-testid="budget-row" data-tone={tone} className={cn(COLS, "h-12 border-b border-border/50 last:border-0")}>
								<span className="truncate font-medium">{c.category}</span>
								<span>
									{editing === c.category ? (
										<AmountInput
											label={`${c.category} budget`}
											initial={c.limit}
											onCancel={() => setEditing(null)}
											onSave={async (v) => {
												await onSet(c.category, v);
												setEditing(null);
											}}
										/>
									) : editable ? (
										<button
											type="button"
											aria-label={`Edit ${c.category} budget`}
											onClick={() => setEditing(c.category)}
											className="-mx-1.5 h-7 rounded-md px-1.5 hover:bg-muted"
										>
											{money(c.limit)}
										</button>
									) : (
										money(c.limit)
									)}
								</span>
								<span className="max-sm:hidden">{money(c.spent)}</span>
								<span className={cn(tone === "bad" ? "font-medium text-bad" : tone === "warn" ? "text-amber-700" : left === 0 && "text-muted-foreground")}>
									{left < 0 ? `${money(-left)} over` : money(left)}
								</span>
								<span className="flex min-w-0 items-center gap-2">
									<span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
										<i className={cn("block h-full rounded-full", TONE[tone])} style={{ width: `${Math.min(100, (c.spent / c.limit) * 100)}%` }} />
									</span>
									<span className="w-9 shrink-0 text-right text-[12px] text-muted-foreground">{Math.round((c.spent / c.limit) * 100)}%</span>
								</span>
							</div>
						);
					})}
					{adding && (
						<NewCategory
							onCancel={() => setAdding(false)}
							onSave={async (name, v) => {
								await onSet(name, v);
								setAdding(false);
							}}
						/>
					)}
				</div>
			)}
			{(total !== null || editable) && (
				<div data-testid="budget-footer" className="label-ui mt-3 flex flex-wrap items-center gap-2 text-muted-foreground normal-case tabular-nums">
					{total !== null && cats.length > 0 && (
						<span>
							Categories add up to {money(sum)}
							{sum < total ? ` · ${money(total - sum)} of your ${money(total)} is unassigned` : sum > total ? ` · ${money(sum - total)} more than your ${money(total)}` : ""}
						</span>
					)}
					{editable && !adding && (
						<button type="button" onClick={() => setAdding(true)} className="ml-auto text-foreground/80 hover:text-foreground">
							+ Add category
						</button>
					)}
				</div>
			)}
		</PageCard>
	);
}

function AmountInput({ label, initial, onSave, onCancel }: { label: string; initial: number; onSave: (v: number) => void; onCancel: () => void }) {
	const [v, setV] = useState(String(initial));
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => ref.current?.select(), []);
	return (
		<input
			ref={ref}
			aria-label={label}
			inputMode="decimal"
			value={v}
			onChange={(e) => setV(e.target.value)}
			onBlur={onCancel}
			onKeyDown={(e) => {
				if (e.key === "Escape") onCancel();
				if (e.key === "Enter" && Number(v) > 0) onSave(Number(v));
			}}
			className="-mx-1.5 h-7 w-full max-w-[96px] rounded-md border border-border bg-card px-1.5 tabular-nums"
		/>
	);
}

function NewCategory({ onSave, onCancel }: { onSave: (name: string, v: number) => void; onCancel: () => void }) {
	const [name, setName] = useState("");
	const [v, setV] = useState("");
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => ref.current?.focus(), []);
	const keys = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") onCancel();
		if (e.key === "Enter" && name.trim() && Number(v) > 0) onSave(name.trim(), Number(v));
	};
	return (
		<div className={cn(COLS, "h-12")}>
			<input ref={ref} aria-label="New category" placeholder="Category" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={keys} maxLength={60} className="h-7 min-w-0 rounded-md border border-border bg-card px-1.5" />
			<input aria-label="New category budget" placeholder="Amount" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={keys} className="h-7 w-full max-w-[96px] rounded-md border border-border bg-card px-1.5" />
			<span className="label-ui col-span-3 text-muted-foreground max-sm:col-span-2">Enter to save · Esc</span>
		</div>
	);
}
