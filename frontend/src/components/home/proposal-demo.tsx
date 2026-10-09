"use client";

// "Nothing changes without you": a suggestion card whose Approve / Reject actually respond. Showcase only.
import { useState } from "react";
import { Check, Receipt, RotateCcw, Sparkles, X } from "lucide-react";
import { label } from "./mocks";

type Decision = "approve" | "reject" | null;

const REPLIES = {
	approve: {
		icon: Check,
		tone: "bg-[#4ade80]/15 text-[#4ade80]",
		text: "Done. The second charge is flagged and on this week's to-do list, with both receipts attached.",
	},
	reject: {
		icon: X,
		tone: "bg-white/10 text-white",
		text: "Okay, I'll leave it as it is. It stays in your activity log if you change your mind.",
	},
} as const;

export function ProposalDemo() {
	const [decision, setDecision] = useState<Decision>(null);
	const reply = decision ? REPLIES[decision] : null;

	return (
		<div
			className={`w-full max-w-[440px] overflow-hidden rounded-[26px] border bg-[linear-gradient(160deg,rgb(255_255_255/0.2)_0%,rgb(255_255_255/0.07)_45%,rgb(0_0_0/0.25)_100%)] p-6 text-left shadow-[0_30px_80px_rgb(0_0_0/0.35)] backdrop-blur-2xl transition-colors duration-500 ${
				decision === "approve" ? "border-[#4ade80]/40" : "border-white/25"
			}`}
		>
			<div className="flex items-center justify-between">
				<span className={`${label} flex items-center gap-2 text-white/75`}>
					<Sparkles className="size-3.5" fill="currentColor" strokeWidth={1} /> Lumen suggests
				</span>
				<span className="text-[12px] text-white/55">just now</span>
			</div>
			<p className="mt-4 font-display text-[28px] leading-[1.1] font-light text-white">Flag a double charge?</p>
			<p className="mt-2 text-[15px] leading-relaxed text-white/80">
				FreshMart charged you twice for the same order on 12 Oct. Flag the second one so you can ask for a refund.
			</p>
			<div className="mt-4 flex flex-wrap gap-2">
				{["10:41 am", "10:42 am"].map((time) => (
					<span key={time} className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-[13px] text-white">
						<Receipt className="size-4 text-white/60" strokeWidth={1.5} /> ₹3,465 · {time}
					</span>
				))}
			</div>

			<div className="mt-5 border-t border-white/15 pt-4">
				{reply ? (
					<div className="flex items-start gap-3" style={{ animation: "fade-up 450ms cubic-bezier(0.22,1,0.36,1) both" }}>
						<span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${reply.tone}`}>
							<reply.icon className="size-4" strokeWidth={2} />
						</span>
						<div className="flex-1">
							<p className="text-[14.5px] leading-relaxed text-white">{reply.text}</p>
							<button
								type="button"
								onClick={() => setDecision(null)}
								className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-white/60 transition-colors hover:text-white"
							>
								<RotateCcw className="size-3" /> Undo
							</button>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between">
						<span className={`${label} text-white/60`}>Low risk</span>
						<span className="flex gap-2">
							<button
								type="button"
								onClick={() => setDecision("reject")}
								className="rounded-lg bg-white/10 px-4 py-2 text-[14px] text-white transition-colors duration-200 hover:bg-white/20"
							>
								Reject
							</button>
							<button
								type="button"
								onClick={() => setDecision("approve")}
								className="rounded-lg bg-white px-4 py-2 text-[14px] text-black transition-opacity duration-200 hover:opacity-85"
							>
								Approve
							</button>
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
