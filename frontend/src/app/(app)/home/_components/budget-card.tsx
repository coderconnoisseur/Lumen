"use client";

import { useRef, useState } from "react";
import { agentApi, budgetApi, type BudgetState, type Proposal } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { HomeCard } from "./card";

// Overall budget = the profile's monthly budget (onboarding); per-category limits come from approved set_budget
// proposals or PUT /api/budget. Nothing here is invented: with neither, the card says so.
export function BudgetCard({ budget, monthName, today, loading }: { budget: BudgetState | null; monthName: string; today: Date; loading: boolean }) {
	const money = useMoney();
	const total = budget?.monthly_budget ?? null;
	const cats = (budget?.categories ?? []).slice(0, 3);
	const spent = budget?.spent ?? 0;
	const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;

	return (
		<HomeCard title={`Budget · ${monthName}`} loading={loading} skeletonHeight={64} data-testid="budget-card">
			{total ? (
				<>
					<div className="text-[22px] font-medium tracking-tight">
						{money(spent)} <span className="text-[13px] font-normal text-muted-foreground">of {money(total)}</span>
					</div>
					<div className="my-2 h-2 overflow-hidden rounded-full bg-accent">
						<i className={cn("block h-full", spent > total ? "bg-bad" : "bg-good")} style={{ width: `${Math.min(100, (spent / total) * 100)}%` }} />
					</div>
					<p className="text-[12px] text-muted-foreground">
						{spent > total
							? `${money(spent - total)} over`
							: `${money(total - spent)} left · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} · ~${money((total - spent) / daysLeft)}/day`}
					</p>
				</>
			) : cats.length === 0 ? (
				<>
					<p className="text-[15px] font-medium">No budget yet</p>
					<p className="mt-1 text-[12.5px] text-muted-foreground">Lumen can draft one from your last 3 months.</p>
				</>
			) : null}
			{cats.length > 0 && (
				<div className={cn(total && "mt-2.5 border-t border-border pt-2")}>
					{cats.map((c) => (
						<div key={c.category} className="flex items-center gap-2 py-0.5 text-[12.5px]">
							<span className="min-w-0 flex-1 truncate">{c.category}</span>
							<span className={cn("shrink-0 tabular-nums", c.spent > c.limit && "text-bad")}>
								{money(c.spent)} / {money(c.limit)}
							</span>
						</div>
					))}
				</div>
			)}
		</HomeCard>
	);
}

type Line = Proposal & { decided?: "approve" | "reject" };

// "Let Lumen draft your budget": files set_budget proposals (POST /api/budget/draft) and lets you approve each line.
export function DraftBudgetPromo({ onChanged }: { onChanged: () => void }) {
	const money = useMoney();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [lines, setLines] = useState<Line[] | null>(null);
	const [deciding, setDeciding] = useState(false);
	const [replaced, setReplaced] = useState(false);
	const inFlight = useRef(false); // a ref, so a double click is blocked before React re-renders

	async function draft() {
		setBusy(true);
		try {
			setLines(await budgetApi.draft());
			setReplaced(false);
			setOpen(true);
		} catch {
			toast.error("Couldn't draft a budget right now.");
		} finally {
			setBusy(false);
		}
	}

	async function decide(ids: string[], decision: "approve" | "reject") {
		if (inFlight.current) return;
		inFlight.current = true;
		setDeciding(true);
		try {
			for (const id of ids) {
				await agentApi.decide(id, decision);
				setLines((ls) => ls?.map((l) => (l.id === id ? { ...l, decided: decision } : l)) ?? ls);
			}
		} catch (error) {
			// a newer draft (from here or from Ask Lumen) retired these lines
			if ((error as { response?: { status?: number } })?.response?.status === 409) setReplaced(true);
			else toast.error("Couldn't save that decision.");
		} finally {
			inFlight.current = false;
			setDeciding(false);
		}
	}

	const pending = (lines ?? []).filter((l) => !l.decided).map((l) => l.id);

	return (
		<section className="rounded-[14px] bg-accent-soft px-4 py-3.5">
			<h3 className="text-[15px] font-semibold">Let Lumen draft your budget</h3>
			<p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
				Built from 3 months of your actual spending. You approve every line before it&apos;s saved.
			</p>
			<button
				type="button"
				onClick={() => void draft()}
				disabled={busy}
				className="label-ui mt-2.5 rounded-full bg-foreground px-3.5 py-1.5 text-background transition-opacity disabled:opacity-60"
			>
				Draft budget
			</button>
			<Dialog
				open={open}
				onOpenChange={(o) => {
					setOpen(o);
					if (!o) onChanged();
				}}
			>
				<DialogContent className="max-w-md">
					<DialogTitle>Your draft budget</DialogTitle>
					<DialogDescription>Each line is a monthly limit. Nothing is saved until you approve it.</DialogDescription>
					{lines && lines.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Not enough history yet. Lumen needs about two months of spending to draft a budget.
						</p>
					) : (
						<>
							<div className="divide-y divide-border">
								{lines?.map((l) => (
									<div key={l.id} data-testid="draft-line" className="flex items-center gap-3 py-2.5">
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">{l.target}</p>
											<p className="truncate text-[12px] text-muted-foreground">{l.reason}</p>
										</div>
										<span className="shrink-0 text-sm tabular-nums">{money(Number(l.payload.limit))}</span>
										<span className="flex w-[118px] shrink-0 justify-end gap-1.5">
											{l.decided ? (
												<span className={cn("text-[12.5px] font-medium", l.decided === "approve" ? "text-good" : "text-muted-foreground")}>
													{l.decided === "approve" ? "Approved" : "Skipped"}
												</span>
											) : (
												<>
													<button type="button" disabled={deciding} className="rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-accent disabled:opacity-50" onClick={() => void decide([l.id], "reject")}>
														Skip
													</button>
													<button type="button" disabled={deciding} className="rounded-md bg-primary px-2 py-1 text-[12.5px] text-primary-foreground disabled:opacity-50" onClick={() => void decide([l.id], "approve")}>
														Approve
													</button>
												</>
											)}
										</span>
									</div>
								))}
							</div>
							{replaced && (
								<p role="status" className="text-[13px] text-bad">
									This draft was replaced. Draft again.
								</p>
							)}
							<button
								type="button"
								disabled={pending.length === 0 || deciding || replaced}
								onClick={() => void decide(pending, "approve")}
								className="mt-1 w-full rounded-lg bg-foreground py-2 text-sm text-background disabled:opacity-50"
							>
								Approve all
							</button>
						</>
					)}
				</DialogContent>
			</Dialog>
		</section>
	);
}
