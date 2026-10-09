"use client";

// A change the agent proposed, waiting for a human. Adapted from Beautiful UI's Recommendation Card (beautifului.dev, MIT).
import { useState } from "react";
import { agentApi, type Proposal } from "@/lib/api/client";
import { toast } from "@/lib/toast";
import { Button } from "./button";

const TITLES: Record<string, string> = {
	flag_invoice: "Flag this invoice?",
	mark_paid: "Mark this as paid?",
	update_category: "Change the category?",
	follow_up_vendor: "Follow up with this vendor?",
};

const RISK: Record<string, { bars: number; tone: string }> = {
	low: { bars: 1, tone: "var(--green)" },
	medium: { bars: 2, tone: "var(--orange)" },
	high: { bars: 3, tone: "var(--red)" },
};

function Meter({ bars, tone }: { bars: number; tone: string }) {
	return (
		<span className="flex items-end gap-0.5" aria-hidden>
			{[0, 1, 2].map((bar) => (
				<span key={bar} className="w-1 rounded-full" style={{ height: 10, background: bar < bars ? tone : "var(--line-strong)" }} />
			))}
		</span>
	);
}

export function ProposalCard({ proposal }: { proposal: Proposal }) {
	const [decided, setDecided] = useState<"approve" | "reject" | null>(null);
	const [busy, setBusy] = useState(false);
	const risk = RISK[proposal.risk] ?? RISK.medium;
	const details = Object.entries(proposal.payload);

	async function decide(decision: "approve" | "reject") {
		setBusy(true);
		try {
			await agentApi.decide(proposal.id, decision);
			setDecided(decision);
		} catch {
			toast.error("Couldn't save your decision.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="w-full max-w-lg overflow-hidden rounded-card bg-surface shadow-card">
			<div className="px-3 pt-3 pb-2">
				<span className="text-[14px] font-medium text-ink">{TITLES[proposal.type] ?? "Approve this change?"}</span>
				<p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
					<span className="mr-1 inline-flex items-center rounded-chip bg-inset px-1.5 font-mono text-[12px] text-ink shadow-hairline">
						{proposal.target}
					</span>
					{details.map(([key, value]) => (
						<span key={key} className="mr-1 inline-flex items-center rounded-chip bg-accent-tint px-1.5 text-[12px] text-accent-ink">
							{key.replace(/_/g, " ")}: {String(value)}
						</span>
					))}
					<span className="mt-1.5 block">{proposal.reason}</span>
				</p>
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-line px-2.5 py-2.5">
				<span className="flex items-center gap-2">
					<Meter {...risk} />
					<span className="text-[12.5px] font-medium text-ink-2 capitalize">{proposal.risk} risk</span>
				</span>
				{decided ? (
					<span className={`text-[12.5px] font-medium ${decided === "approve" ? "text-green" : "text-ink-3"}`}>
						{decided === "approve" ? "Approved" : "Rejected"}
					</span>
				) : (
					<span className="flex items-center gap-2">
						<Button variant="secondary" disabled={busy} onClick={() => void decide("reject")}>
							Reject
						</Button>
						<Button variant="accent" disabled={busy} onClick={() => void decide("approve")}>
							Approve
						</Button>
					</span>
				)}
			</div>
		</div>
	);
}
