"use client";

import Link from "next/link";
import { useState } from "react";
import { PageCard } from "@/components/page/page-card";
import { VendorChip } from "@/components/page/vendor-chip";
import { GmailOAuthButton } from "@/components/gmailOAuthButton";
import { emailConfigApi, type StatementImport } from "@/lib/api/client";
import { toast } from "@/lib/toast";
import type { EmailStatus } from "../use-receipts-data";

const dayMonth = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T00:00` : s).toLocaleString("en-GB", { day: "numeric", month: "short" }) : "");
const ago = (s: string) => {
	const m = Math.round((Date.now() - new Date(s).getTime()) / 60_000);
	return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const PARTS = [
	{ key: "imported", label: "new", className: "bg-primary" },
	{ key: "matched", label: "matched", className: "bg-primary/45" },
	{ key: "duplicates", label: "duplicates", className: "bg-amber-500" },
	{ key: "credits", label: "credits skipped", className: "bg-muted-foreground/25" },
] as const;

// Statement imports (spec 2026-10-22 §4.5): one entry per import with what became of its lines. Counts are as the
// import returned them; "matched" lines were already recorded from a receipt.
export function ImportsCard({ imports }: { imports: StatementImport[] }) {
	return (
		<PageCard
			title="Statement imports"
			action={<Link href="/receipts/import" className="normal-case text-foreground/80 hover:text-foreground">Import statement</Link>}
			skeletonHeight={0}
			data-testid="imports"
		>
			{imports.length === 0 ? (
				<p className="text-[13px] text-muted-foreground">No statements yet. Import a CSV from your bank or card and its spending lines become transactions.</p>
			) : (
				<div className="flex flex-col gap-4">
					{imports.slice(0, 4).map((i) => {
						const total = PARTS.reduce((s, p) => s + i[p.key], 0) || 1;
						const name = i.label ?? i.file_name ?? "Statement";
						return (
							<div key={i.id}>
								<div className="flex items-center gap-2.5">
									<VendorChip name={name} />
									<span className="min-w-0 flex-1">
										<b className="block truncate text-[13.5px] font-medium">{name}</b>
										<small className="block text-[12px] text-muted-foreground">
											{i.period_from ? `${dayMonth(i.period_from)} – ${dayMonth(i.period_to)} · ` : ""}imported {dayMonth(i.created_at)}
										</small>
									</span>
									<span className="text-[13px] tabular-nums">{i.lines} lines</span>
								</div>
								<div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
									{PARTS.map((p) => i[p.key] > 0 && <i key={p.key} className={p.className} style={{ width: `${(i[p.key] / total) * 100}%` }} />)}
								</div>
								<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground tabular-nums">
									{PARTS.map((p) => i[p.key] > 0 && <span key={p.key}>{i[p.key]} {p.key === "duplicates" && i[p.key] === 1 ? "duplicate" : p.label}</span>)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</PageCard>
	);
}

// From your inbox: Gmail (or IMAP) receipt collection. Connected: what it's done and Check now / Pause. Not connected:
// connect Gmail here (it had no home in the app since the old dashboard went).
export function InboxCard({ email, onChanged }: { email: EmailStatus | null; onChanged: () => void }) {
	const [busy, setBusy] = useState(false);
	async function act(f: () => Promise<unknown>, done?: string) {
		setBusy(true);
		try {
			await f();
			if (done) toast.success(done);
			onChanged();
		} catch {
			toast.error("Couldn't reach your inbox right now.");
		} finally {
			setBusy(false);
		}
	}
	const on = email?.configured;
	return (
		<PageCard
			title="From your inbox"
			extra={on && <span className={email.polling_enabled ? "rounded-full bg-good/10 px-2 py-0.5 normal-case text-good" : "rounded-full bg-muted px-2 py-0.5 normal-case"}>{email.polling_enabled ? "Connected" : "Paused"}</span>}
			skeletonHeight={0}
			data-testid="inbox"
		>
			{on ? (
				<>
					<div className="flex items-center gap-2.5">
						<VendorChip name={email.provider === "gmail" ? "Gmail" : "Mail"} />
						<span className="min-w-0">
							<b className="block truncate text-[13.5px] font-medium">{email.email_address}</b>
							<small className="block text-[12px] text-muted-foreground">
								{email.last_successful_poll ? `Checked ${ago(email.last_successful_poll)} · ` : ""}
								{email.transactions_added ?? 0} receipts added
							</small>
						</span>
					</div>
					{email.last_error && <p className="mt-2 text-[12px] text-bad">{email.last_error}</p>}
					<div className="mt-3 flex gap-2">
						<button type="button" disabled={busy} onClick={() => void act(() => emailConfigApi.pollNow(), "Checking your inbox")} className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px] disabled:opacity-50">
							Check now
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => void act(() => (email.polling_enabled ? emailConfigApi.pausePolling() : emailConfigApi.resumePolling()))}
							className="rounded-full px-3 py-1 text-[12.5px] text-muted-foreground hover:text-foreground disabled:opacity-50"
						>
							{email.polling_enabled ? "Pause" : "Resume"}
						</button>
					</div>
				</>
			) : (
				<>
					<p className="mb-3 text-[13px] text-muted-foreground">Connect Gmail and Lumen files receipts and invoices from your inbox. You still approve anything it isn&apos;t sure about.</p>
					<GmailOAuthButton onSuccess={() => onChanged()} />
				</>
			)}
		</PageCard>
	);
}
