"use client";

// Minimal page to exercise the review queue API. The real review screen comes with the UI refactor.
import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { reviewApi, type ReviewItem } from "@/lib/api/client";
import { toast } from "@/lib/toast";

function errorMessage(error: unknown, fallback: string): string {
	return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

export default function ReviewContent() {
	const [items, setItems] = useState<ReviewItem[]>([]);
	const [totals, setTotals] = useState<Record<string, string>>({});

	const load = useCallback(async () => {
		try {
			setItems(await reviewApi.list());
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't load the review queue."));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function decide(item: ReviewItem, decision: "approve" | "reject") {
		const total = totals[item.id];
		const edits = decision === "approve" && total ? { total_amount: Number(total) } : {};
		try {
			const done = await reviewApi.decide(item.id, decision, { edits });
			toast.success(decision === "approve" ? `Approved${done.flags.length ? " (with warnings)" : ""}` : "Rejected");
			setItems((list) => list.filter((i) => i.id !== item.id));
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't save the decision."));
		}
	}

	return (
		<DashboardShell title="Review queue (test)" description="Invoices the checks weren't sure about. Nothing becomes a transaction until you approve it." eyebrow="Review">
			<Card className="space-y-3 p-6">
				{items.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nothing to review. Upload an invoice whose total doesn't match its line items, or the same invoice twice.</p>
				) : items.map((item) => (
					<div key={item.id} className="space-y-2 rounded border p-3 text-sm">
						<p>
							<b>{String(item.invoice.vendor_name ?? "Unknown vendor")}</b> · {String(item.invoice.invoice_number ?? "no number")} ·{" "}
							{String(item.invoice.date ?? "no date")} · total {String(item.invoice.total_amount ?? "?")} · confidence {item.confidence}
						</p>
						<ul className="list-disc pl-5 text-muted-foreground">
							{item.flags.map((f) => <li key={f.rule}><b>{f.severity === "fail" ? "Fail" : "Warning"}:</b> {f.detail}</li>)}
						</ul>
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<Input className="sm:w-48" inputMode="decimal" placeholder="Correct total (optional)"
								value={totals[item.id] ?? ""} onChange={(e) => setTotals((t) => ({ ...t, [item.id]: e.target.value }))} />
							<Button size="sm" onClick={() => void decide(item, "approve")}>Approve</Button>
							<Button size="sm" variant="outline" onClick={() => void decide(item, "reject")}>Reject</Button>
						</div>
					</div>
				))}
			</Card>
		</DashboardShell>
	);
}
