"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { agentApi, type BudgetState, type Proposal } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type DraftLine = Proposal & { decided?: "approve" | "reject" };

// Lumen's draft, on the page (spec 2026-10-22 §4.4; it was a dialog on Home). Each line is a pending set_budget
// proposal: the proposed limit against the one in force, the basis sentence, and Skip / Approve named for the category.
// Nothing changes until a line is approved. No month-bars glyph: the basis has no per-month amounts to draw.
export function DraftPanel({
	lines,
	setLines,
	budget,
	monthName,
	onDecided,
}: {
	lines: DraftLine[];
	setLines: (f: (ls: DraftLine[] | null) => DraftLine[] | null) => void;
	budget: BudgetState | null;
	monthName: string;
	onDecided: () => void;
}) {
	const money = useMoney();
	const [deciding, setDeciding] = useState(false);
	const [replaced, setReplaced] = useState(false);
	const inFlight = useRef(false); // a ref, so a double click is blocked before React re-renders
	// the limits before this draft: approving a line reloads the budget, and "was" must not become "no change"
	const [current] = useState(() => new Map((budget?.categories ?? []).map((c) => [c.category.toLowerCase(), c.limit])));
	const was = (l: DraftLine) => current.get(l.target.toLowerCase());
	const limit = (l: DraftLine) => Number(l.payload.limit);
	const pending = lines.filter((l) => !l.decided);
	const taking = lines.filter((l) => l.decided !== "reject");
	const after = [...current.entries()].filter(([k]) => !taking.some((l) => l.target.toLowerCase() === k)).reduce((s, [, v]) => s + v, 0)
		+ taking.reduce((s, l) => s + limit(l), 0);

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
			onDecided();
		}
	}

	return (
		<section data-testid="draft-panel" aria-labelledby="draft-title" className="rounded-2xl border border-primary/20 bg-accent-soft/60 px-5 py-[18px]">
			<div className="flex items-center gap-2">
				<Sparkles className="size-4 text-primary" />
				<h2 id="draft-title" className="text-[15px] font-semibold">Lumen&apos;s draft for {monthName}</h2>
				{lines.length > 0 && (
					<span className="label-ui ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-primary">
						{lines.length - pending.length} of {lines.length} decided
					</span>
				)}
			</div>
			{lines.length === 0 ? (
				<p className="mt-2 text-[13px] text-muted-foreground">Not enough history yet. Lumen needs about two months of spending to draft a budget.</p>
			) : (
				<>
					<p className="mt-1 text-[12.5px] text-muted-foreground">Each line is a monthly limit; nothing changes until you approve it.</p>
					<div className="mt-2 divide-y divide-border/60">
						{lines.map((l) => {
							const old = was(l);
							return (
								<div key={l.id} data-testid="draft-line" className={cn("py-3", l.decided && "opacity-70")}>
									<div className="flex items-baseline gap-2">
										<span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{l.target}</span>
										<span className="text-[13.5px] font-medium tabular-nums">{money(limit(l))}</span>
										<small className="w-24 text-right text-[12px] text-muted-foreground tabular-nums">
											{old === undefined ? "new" : old === limit(l) ? "no change" : `was ${money(old)}`}
										</small>
									</div>
									<div className="mt-1 flex items-start gap-3">
										<p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">{l.reason}</p>
										<span className="flex h-7 shrink-0 items-center gap-1.5">
											{l.decided ? (
												<span className={cn("text-[12.5px] font-medium", l.decided === "approve" ? "text-good" : "text-muted-foreground")}>
													{l.decided === "approve" ? "✓ Approved" : old === undefined ? "Skipped" : `Skipped · keeps ${money(old)}`}
												</span>
											) : (
												<>
													<button type="button" aria-label={`Skip ${l.target}`} disabled={deciding || replaced} onClick={() => void decide([l.id], "reject")} className="rounded-md px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-card disabled:opacity-50">
														Skip
													</button>
													<button type="button" aria-label={`Approve ${l.target} at ${money(limit(l))}`} disabled={deciding || replaced} onClick={() => void decide([l.id], "approve")} className="rounded-md border border-border bg-card px-2 py-1 text-[12.5px] hover:border-foreground/30 disabled:opacity-50">
														Approve
													</button>
												</>
											)}
										</span>
									</div>
								</div>
							);
						})}
					</div>
					{replaced && (
						<p role="status" className="mt-2 text-[13px] text-bad">
							This draft was replaced. Draft again.
						</p>
					)}
					<div className="mt-3 flex flex-wrap items-center gap-3">
						{pending.length > 0 && (
							<button
								type="button"
								disabled={deciding || replaced}
								onClick={() => void decide(pending.map((l) => l.id), "approve")}
								className="rounded-full bg-foreground px-3.5 py-1.5 text-[13px] text-background disabled:opacity-50"
							>
								Approve remaining {pending.length}
							</button>
						)}
						{budget?.monthly_budget ? (
							<small className="text-[12px] text-muted-foreground tabular-nums">
								Categories would add up to {money(after)} of {money(budget.monthly_budget)}
							</small>
						) : null}
					</div>
				</>
			)}
		</section>
	);
}
