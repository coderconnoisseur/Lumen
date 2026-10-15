"use client";

// The invoice a user attached in chat: what was read, what the checks found, and one button to save it.
import { useState } from "react";
import { agentApi, type ChatAttachment } from "@/lib/api/client";
import { Button } from "./button";

const TONE = { note: "text-ink-3", warn: "text-orange", fail: "text-red" };

export function InvoiceCard({ attachment }: { attachment: ChatAttachment }) {
	const [saved, setSaved] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const { invoice, flags = [], proposal_id } = attachment;

	async function save() {
		setBusy(true);
		setError(null);
		try {
			const applied = await agentApi.decide(proposal_id!, "approve");
			setSaved(applied?.status === "flagged" ? "Saved for review" : "Saved");
		} catch (e) {
			const status = (e as { response?: { status?: number } })?.response?.status;
			if (status === 409) setSaved("Saved");
			else setError("Couldn't save this invoice. Please try again.");
		} finally {
			setBusy(false);
		}
	}

	if (!invoice) {
		return (
			<div className="w-full max-w-lg rounded-card bg-surface px-3 py-3 text-[13px] text-ink-2 shadow-card">
				{attachment.error ?? "I couldn't read an invoice in that file."}
			</div>
		);
	}

	const total = invoice.total_amount == null ? "?" : `${invoice.total_amount} ${invoice.currency ?? ""}`;
	const items = invoice.items ?? [];

	return (
		<div className="w-full max-w-lg overflow-hidden rounded-card bg-surface shadow-card">
			<div className="px-3 pt-3 pb-2">
				<div className="flex items-baseline justify-between gap-3">
					<span className="truncate text-[14px] font-medium text-ink">{invoice.vendor_name ?? "Unknown vendor"}</span>
					<span className="shrink-0 text-[14px] font-medium text-ink">{total}</span>
				</div>
				<p className="mt-1 text-[12.5px] text-ink-3">
					{[invoice.invoice_number && `#${invoice.invoice_number}`, invoice.date].filter(Boolean).join(" · ")}
				</p>
				{items.length > 0 && (
					<ul className="mt-2 flex flex-col gap-0.5 text-[12.5px] text-ink-2">
						{items.slice(0, 5).map((item, i) => (
							<li key={i} className="flex justify-between gap-3">
								<span className="truncate">{item.item_name}</span>
								<span className="shrink-0">{item.total_price ?? ""}</span>
							</li>
						))}
						{items.length > 5 && <li className="text-ink-3">+{items.length - 5} more</li>}
					</ul>
				)}
				{flags.length > 0 && (
					<ul className="mt-2 flex flex-col gap-0.5 text-[12.5px]">
						{flags.map((f, i) => (
							<li key={i} className={TONE[f.severity]}>
								{f.detail}
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-line px-2.5 py-2.5">
				<span className="min-w-0 truncate text-[12.5px] text-red">{error}</span>
				{saved ? (
					// same height as the button it replaces, so saving doesn't shift the chat
					<span className="flex h-[27px] items-center text-[12.5px] font-medium text-green">{saved}</span>
				) : (
					<Button variant="primary" disabled={busy || !proposal_id} onClick={() => void save()}>
						Save to my records
					</Button>
				)}
			</div>
		</div>
	);
}
