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

			{/* All three states share one grid cell sized to the tallest, so choosing never resizes the card or shifts
			    the page; the states crossfade in place. */}
			<div className="mt-5 grid border-t border-white/15 pt-4">
				{(Object.keys(REPLIES) as (keyof typeof REPLIES)[]).map((key) => {
					const r = REPLIES[key];
					const on = decision === key;
					return (
						<div
							key={key}
							aria-hidden={!on}
							className={`col-start-1 row-start-1 flex items-start gap-3 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
								on ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
							}`}
						>
							<span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${r.tone}`}>
								<r.icon className="size-4" strokeWidth={2} />
							</span>
							<div className="flex-1">
								<p className="text-[14.5px] leading-relaxed text-white">{r.text}</p>
								<button
									type="button"
									tabIndex={on ? 0 : -1}
									onClick={() => setDecision(null)}
									className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-white/60 transition-colors hover:text-white"
								>
									<RotateCcw className="size-3" /> Undo
								</button>
							</div>
						</div>
					);
				})}
				<div
					aria-hidden={!!decision}
					className={`col-start-1 row-start-1 flex items-center justify-between self-start transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
						decision ? "pointer-events-none -translate-y-2 opacity-0" : "opacity-100"
					}`}
				>
					<span className={`${label} text-white/60`}>Low risk</span>
					<span className="flex gap-2">
						<button
							type="button"
							tabIndex={decision ? -1 : 0}
							onClick={() => setDecision("reject")}
							className="rounded-full bg-white/10 px-4 py-2 text-[14px] font-medium text-white transition-colors duration-200 hover:bg-white/20"
						>
							Reject
						</button>
						<button
							type="button"
							tabIndex={decision ? -1 : 0}
							onClick={() => setDecision("approve")}
							className="rounded-full bg-white px-4 py-2 text-[14px] font-medium text-black transition-colors duration-200 hover:bg-white/90"
						>
							Approve
						</button>
					</span>
				</div>
			</div>
		</div>
	);
}
