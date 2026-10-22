"use client";

import { useState } from "react";
import { PageCard } from "@/components/page/page-card";
import { VendorChip } from "@/components/page/vendor-chip";
import { reviewApi, type ReviewItem } from "@/lib/api/client";
import { eventBus, EVENTS } from "@/lib/events";
import { useMoney } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Field = { key: "vendor_name" | "date" | "invoice_number" | "total_amount"; label: string };
const FIELDS: Field[] = [
	{ key: "vendor_name", label: "Vendor" },
	{ key: "date", label: "Date" },
	{ key: "invoice_number", label: "Bill no." },
	{ key: "total_amount", label: "Total" },
];
// which field each validation flag (backend extract/validate.py) is about, and the reason in plain words
const DOUBT: Record<string, Field["key"]> = { total_mismatch: "total_amount", duplicate: "invoice_number", bad_date: "date", unknown_vendor: "vendor_name", no_currency: "total_amount" };
const REASON: Record<string, string> = {
	total_mismatch: "Totals don't add up.",
	duplicate: "Looks like a duplicate.",
	bad_date: "Date unclear.",
	unknown_vendor: "New to you.",
	no_currency: "No currency printed.",
	unknown_po: "Purchase order not found.",
	po_mismatch: "Doesn't match its purchase order.",
	possible_injection: "Unusual text on the bill.",
};
const dayMonth = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short" }) : "");
// the checks' details are terse ("line items 80 + tax 20 != total 110"); the arithmetic one gets a sentence instead
const plain = (rule: string, detail: string) =>
	rule === "total_mismatch" ? "The items and tax don't add up to the printed total." : `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
const errorText = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

// Needs your review (spec 2026-10-22 §4.5; replaces the old Review tab): one card per flagged receipt with the fields
// the checks doubted highlighted, the reason in plain words, and Approve / Edit / Reject. A duplicate offers "Keep both"
// instead of Approve. Compare is left out: the item doesn't carry the record it duplicates.
export function ReviewCards({ items, onDecided }: { items: ReviewItem[]; onDecided: (id: string) => void }) {
	return (
		<PageCard
			title="Needs your review"
			extra={
				<>
					<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 tabular-nums">{items.length}</span>
					<span className="normal-case max-md:hidden">Highlighted fields are the ones Lumen wasn&apos;t sure about</span>
				</>
			}
			skeletonHeight={0}
			data-testid="review"
		>
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				{items.map((item) => (
					<ReviewCard key={item.id} item={item} onDecided={onDecided} />
				))}
			</div>
		</PageCard>
	);
}

function ReviewCard({ item, onDecided }: { item: ReviewItem; onDecided: (id: string) => void }) {
	const money = useMoney();
	const inv = item.invoice;
	const vendor = String(inv.vendor_name ?? "Unknown vendor");
	const rules = item.flags.map((f) => f.rule);
	const doubtful = new Set(rules.map((r) => DOUBT[r]).filter(Boolean));
	const duplicate = rules.includes("duplicate");
	const first = item.flags.find((f) => f.severity !== "note") ?? item.flags[0];
	const [editing, setEditing] = useState(false);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const show = (k: Field["key"]) => {
		const v = inv[k];
		if (k === "total_amount" && typeof v === "number") return money(v, inv.currency as string | undefined);
		// an ISO date reads as "12 Oct 2026"; anything else is shown as printed, since that's what is in doubt
		if (k === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00`).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });
		return String(v ?? "—");
	};

	async function decide(decision: "approve" | "reject") {
		setBusy(true);
		const changed = Object.fromEntries(
			Object.entries(edits)
				.filter(([k, v]) => v.trim() !== String(inv[k] ?? ""))
				.map(([k, v]) => [k, k === "total_amount" ? Number(v) : v.trim()]),
		);
		try {
			await reviewApi.decide(item.id, decision, decision === "approve" && Object.keys(changed).length ? { edits: changed } : {});
			onDecided(item.id);
			eventBus.emit(EVENTS.REVIEW_DECIDED);
		} catch (e) {
			toast.error(errorText(e) ?? "Couldn't save that decision.");
			setBusy(false);
		}
	}

	return (
		<div data-testid="review-card" className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-background/40 p-3.5">
			<div className="flex items-center gap-2.5">
				<VendorChip name={vendor} />
				<span className="min-w-0 flex-1">
					<b className="block truncate text-[13.5px] font-medium">{vendor}</b>
					<small className="block truncate text-[12px] text-muted-foreground">
						Receipt · {inv.source === "email" ? "from email" : "uploaded"} {dayMonth(item.created_at)}
					</small>
				</span>
				{typeof inv.total_amount === "number" && <span className="text-[14px] font-medium tabular-nums">{money(inv.total_amount, inv.currency as string | undefined)}</span>}
			</div>
			<dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
				{FIELDS.map((f) => (
					<div key={f.key} className="contents">
						<dt data-doubtful={doubtful.has(f.key) || undefined} className="text-muted-foreground">{f.label}</dt>
						<dd className={cn("min-w-0 truncate tabular-nums", doubtful.has(f.key) && "rounded bg-amber-500/15 px-1 text-amber-800")}>
							{editing ? (
								<input
									aria-label={f.label}
									defaultValue={String(inv[f.key] ?? "")}
									inputMode={f.key === "total_amount" ? "decimal" : undefined}
									onChange={(e) => setEdits((x) => ({ ...x, [f.key]: e.target.value }))}
									className="h-6 w-full rounded border border-border bg-card px-1.5"
								/>
							) : (
								show(f.key)
							)}
						</dd>
					</div>
				))}
			</dl>
			{first && (
				<p className="mt-2.5 text-[12.5px] leading-snug text-muted-foreground">
					<b className="font-medium text-foreground">{REASON[first.rule] ?? "Lumen wasn't sure."}</b> {plain(first.rule, first.detail)}
				</p>
			)}
			<div className="mt-auto flex gap-1.5 pt-3">
				{editing ? (
					<>
						<button type="button" disabled={busy} onClick={() => void decide("approve")} className="rounded-full bg-foreground px-3 py-1 text-[12.5px] text-background disabled:opacity-50">
							Save &amp; approve
						</button>
						<button type="button" onClick={() => (setEditing(false), setEdits({}))} className="rounded-full px-3 py-1 text-[12.5px] text-muted-foreground hover:text-foreground">
							Cancel
						</button>
					</>
				) : (
					<>
						<button type="button" disabled={busy} onClick={() => void decide("approve")} className="rounded-full border border-good/40 bg-good/10 px-3 py-1 text-[12.5px] text-good disabled:opacity-50">
							{duplicate ? "Keep both" : "Approve"}
						</button>
						{!duplicate && (
							<button type="button" onClick={() => setEditing(true)} className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px]">
								Edit
							</button>
						)}
						<button type="button" disabled={busy} onClick={() => void decide("reject")} className="ml-auto rounded-full px-3 py-1 text-[12.5px] text-bad hover:bg-bad/10 disabled:opacity-50">
							Reject
						</button>
					</>
				)}
			</div>
		</div>
	);
}
