// Product mockups for the landing page: Lumen's own screens drawn in markup (sample data, no claims).
import type { ReactNode } from "react";
import { Check, FileText, Receipt, ScrollText, Sparkles, TriangleAlert } from "lucide-react";
import { TypingInput } from "./typing-input";

const label = "font-[family-name:var(--font-roboto-mono)] text-[10.5px] font-medium tracking-[0.14em] uppercase";
const panel = "rounded-[14px] border border-white/[0.07] bg-[#161617]";

export function Phone({ children, glass = false }: { children: ReactNode; glass?: boolean }) {
	return (
		<div
			className={`relative mx-auto h-[700px] w-[340px] rounded-[58px] border-[10px] border-[#1d1d1f] shadow-[0_0_0_2px_#3a3a3c,0_40px_80px_rgb(0_0_0/0.35)] ${
				glass ? "bg-white/[0.04] backdrop-blur-[2px]" : "bg-[#0b0b0c]"
			}`}
		>
			<span className="absolute top-3 left-1/2 h-7 w-28 -translate-x-1/2 rounded-full bg-[#0b0b0c]" />
			<div className="absolute inset-0 overflow-hidden rounded-[48px]">{children}</div>
		</div>
	);
}

const HERO_CARDS = [
	["Duplicate", "Same invoice, sent twice.", "FreshMart's FM-2041 arrived again on Tuesday. The copy is held for review, not paid twice."],
	["Totals", "Line items don't add up.", "UrbanWear lists ₹4,120 of items but asks for ₹4,500. Flagged before it was recorded."],
	["Contracts", "Notice period: 60 days.", "Cancelling the TechHub maintenance agreement needs written notice two months ahead."],
	["Forecast", "Next month looks heavier.", "Utilities and travel are trending up. Plan for roughly ₹18,000 more than this month."],
] as const;

/** Glass cards cycling inside the hero phone. */
export function HeroPhone() {
	return (
		<Phone glass>
			<div className="flex flex-col items-center px-6 pt-20 text-center">
				<span className="flex size-11 items-center justify-center rounded-xl border border-white/30 bg-white/15 text-white backdrop-blur">
					<Receipt className="size-5" strokeWidth={1.6} />
				</span>
				<p className="mt-5 font-display text-[30px] leading-[1.1] font-light text-white">
					Lumen checked 12 new invoices today
				</p>
				<div className="home-cycle relative mt-8 h-[190px] w-full">
					{HERO_CARDS.map(([tag, title, body]) => (
						<div
							key={tag}
							className="absolute inset-0 rounded-[22px] border border-white/25 bg-white/15 p-5 text-left backdrop-blur-xl"
						>
							<span className={`${label} text-white/70`}>{tag}</span>
							<p className="mt-3 font-display text-[22px] leading-tight font-light text-white">{title}</p>
							<p className="mt-2 text-[13.5px] leading-[1.45] text-white/85">{body}</p>
						</div>
					))}
				</div>
			</div>
		</Phone>
	);
}

export function InvoiceMock() {
	const rows: [string, string][] = [
		["Vendor", "FreshMart Supermarket"],
		["Invoice", "FM-202606-2041"],
		["Date", "12 Jun 2026"],
		["PO", "PO-U1-202605-06"],
	];
	return (
		<div className={`${panel} w-full max-w-[300px] p-4`}>
			<div className="flex items-center justify-between">
				<span className={`${label} text-[#8a8a8c]`}>Read from PDF</span>
				<span className="flex items-center gap-1 text-[11px] text-[#4ade80]">
					<Check className="size-3" /> Verified
				</span>
			</div>
			<dl className="mt-3 space-y-2 text-[13px]">
				{rows.map(([k, v]) => (
					<div key={k} className="flex justify-between gap-3">
						<dt className="text-[#8a8a8c]">{k}</dt>
						<dd className="truncate text-white">{v}</dd>
					</div>
				))}
			</dl>
			<div className="mt-3 space-y-1.5 border-t border-white/[0.07] pt-3 text-[12.5px] text-[#b4b4b6]">
				<div className="flex justify-between"><span>Basmati rice 5kg × 4</span><span>₹2,160</span></div>
				<div className="flex justify-between"><span>Cooking oil 1L × 6</span><span>₹1,140</span></div>
			</div>
			<div className="mt-3 flex justify-between border-t border-white/[0.07] pt-3 text-[14px] text-white">
				<span>Total</span>
				<span>₹3,465.00</span>
			</div>
		</div>
	);
}

export function FlagsMock() {
	const flags: [string, string, string][] = [
		["#f87171", "Total mismatch", "Items ₹4,120 · invoice ₹4,500"],
		["#f87171", "Duplicate", "FM-2041 already recorded"],
		["#f5a35c", "Unknown vendor", "First invoice from Kirana Hub"],
	];
	return (
		<div className="w-full max-w-[300px] space-y-2">
			{flags.map(([color, title, detail]) => (
				<div key={title} className={`${panel} flex items-start gap-3 p-3.5`}>
					<span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: color }} />
					<div>
						<p className="text-[13.5px] text-white">{title}</p>
						<p className="mt-0.5 text-[12px] text-[#8a8a8c]">{detail}</p>
					</div>
				</div>
			))}
			<div className="flex justify-end gap-2 pt-1">
				<span className="rounded-lg bg-white/[0.07] px-3 py-1.5 text-[12px] text-white">Reject</span>
				<span className="rounded-lg bg-white px-3 py-1.5 text-[12px] text-black">Approve with edits</span>
			</div>
		</div>
	);
}

export function DocsMock() {
	const docs: [string, string][] = [
		["TechHub maintenance agreement", "Contract"],
		["Acme expense policy", "Policy"],
		["PO-U1-202605-06", "Purchase order"],
		["NetLink broadband agreement", "Contract"],
	];
	return (
		<div className={`${panel} w-full max-w-[300px] p-2`}>
			{docs.map(([name, kind]) => (
				<div key={name} className="flex items-center gap-3 rounded-[10px] px-2.5 py-2.5 odd:bg-white/[0.03]">
					<FileText className="size-4 shrink-0 text-[#8a8a8c]" />
					<span className="min-w-0 flex-1 truncate text-[13px] text-white">{name}</span>
					<span className={`${label} shrink-0 text-[9.5px] text-[#8a8a8c]`}>{kind}</span>
				</div>
			))}
		</div>
	);
}

export function SpendMock() {
	const bars: [string, number, string][] = [
		["Electronics", 92, "₹85.7K"],
		["Apparel", 72, "₹66.4K"],
		["Groceries", 69, "₹64.1K"],
		["Transport", 55, "₹50.8K"],
		["Dining", 34, "₹31.1K"],
	];
	return (
		<div className={`${panel} w-full max-w-[300px] p-4`}>
			<span className={`${label} text-[#8a8a8c]`}>Spend by category</span>
			<div className="mt-4 space-y-3">
				{bars.map(([name, pct, value]) => (
					<div key={name}>
						<div className="flex justify-between text-[12.5px]">
							<span className="text-[#b4b4b6]">{name}</span>
							<span className="text-white">{value}</span>
						</div>
						<div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]">
							<div className="h-full rounded-full bg-[#90b8f0]" style={{ width: `${pct}%` }} />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function ForecastMock() {
	return (
		<div className={`${panel} w-full max-w-[300px] p-4`}>
			<span className={`${label} text-[#8a8a8c]`}>Next month</span>
			<p className="mt-2 text-[26px] text-white">₹1,42,000</p>
			<p className="text-[12px] text-[#8a8a8c]">expected spend</p>
			<svg viewBox="0 0 260 110" className="mt-3 w-full">
				<path d="M0 80 L40 70 L80 76 L120 58 L160 62 L190 48" fill="none" stroke="#00b3dd" strokeWidth="2" />
				<path d="M190 48 L225 40 L260 30" fill="none" stroke="#00b3dd" strokeWidth="2" strokeDasharray="4 4" />
				<path d="M190 48 L260 18 L260 44 Z" fill="#00b3dd" opacity="0.12" />
				<circle cx="190" cy="48" r="3.5" fill="#00b3dd" />
				<line x1="0" y1="104" x2="260" y2="104" stroke="rgb(255 255 255 / 0.08)" />
			</svg>
		</div>
	);
}

export function AnomalyMock() {
	const rows: [string, string, string][] = [
		["NetLink Broadband", "₹7,990", "3× your usual bill"],
		["MetroCab", "₹2,480", "Late-night, out of pattern"],
		["Cafe Aroma", "₹1,960", "Charged twice in a minute"],
	];
	return (
		<div className="w-full max-w-[300px] space-y-2">
			{rows.map(([vendor, amount, why]) => (
				<div key={vendor} className={`${panel} p-3.5`}>
					<div className="flex justify-between text-[13.5px] text-white">
						<span>{vendor}</span>
						<span>{amount}</span>
					</div>
					<p className="mt-1 flex items-center gap-1.5 text-[12px] text-[#f5a35c]">
						<TriangleAlert className="size-3" /> {why}
					</p>
				</div>
			))}
		</div>
	);
}

const NOTIFICATIONS = [
	"FreshMart sent invoice FM-2041 twice. The copy is on hold.",
	"Your electricity bill is a third higher than usual this month.",
	"TechHub's notice window opens in 14 days.",
	"3 invoices are waiting for your approval.",
];

/** Cycling notification pill ("always on" section). */
export function Notifications() {
	return (
		<div className="home-cycle relative mx-auto h-[76px] w-full max-w-[460px]">
			{NOTIFICATIONS.map((text) => (
				<div
					key={text}
					className="absolute inset-0 flex items-center gap-4 rounded-[28px] border border-white/[0.08] bg-[#1c1c1e]/90 px-6 backdrop-blur"
				>
					<Sparkles className="size-5 shrink-0 text-[#8a8a8c]" strokeWidth={1.5} />
					<span className="flex-1 text-left text-[15px] leading-snug text-white">{text}</span>
					<span className="shrink-0 text-[12px] text-[#8a8a8c]">now</span>
				</div>
			))}
		</div>
	);
}

const DOC_CHIPS = [
	["Invoice", "FreshMart FM-2041"],
	["Contract", "TechHub maintenance"],
	["Receipt", "MetroCab ride"],
	["Purchase order", "PO-U1-202605-06"],
	["Policy", "Expense policy"],
	["Invoice", "UrbanWear UW-889"],
	["Contract", "NetLink broadband"],
	["Invoice", "Cafe Aroma CA-114"],
] as const;

function DocRow({ reverse = false }: { reverse?: boolean }) {
	const items = reverse ? [...DOC_CHIPS].reverse() : DOC_CHIPS;
	return (
		<div className={`flex w-max gap-3 ${reverse ? "home-marquee-x-rev" : "home-marquee-x"}`}>
			{[...items, ...items].map(([kind, name], i) => (
				<div key={i} className={`${panel} w-[210px] shrink-0 p-4`}>
					<span className={`${label} text-[#8a8a8c]`}>{kind}</span>
					<p className="mt-3 flex items-center gap-2 text-[14px] text-white">
						{kind === "Contract" || kind === "Policy" ? (
							<ScrollText className="size-4 text-[#8a8a8c]" />
						) : (
							<FileText className="size-4 text-[#8a8a8c]" />
						)}
						<span className="truncate">{name}</span>
					</p>
				</div>
			))}
		</div>
	);
}

/** Two rows of documents sliding past in opposite directions. */
export function DocMarquee() {
	return (
		<div className="flex w-full flex-col gap-3 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
			<DocRow />
			<DocRow reverse />
		</div>
	);
}

const CHECKS = [
	"Line items add up to the total",
	"Not a duplicate of a recorded invoice",
	"Vendor is one you've paid before",
	"Date is within the last two years",
	"Currency is stated",
	"Matches purchase order PO-U1-202605-06",
	"No instructions hidden in the text",
];

/** An invoice's checks scrolling past under a summary card. */
export function ChecksMock() {
	return (
		<div className="w-full max-w-[320px]">
			<div className={`${panel} relative z-10 p-4`}>
				<div className="flex items-center gap-2 text-[14px] text-white">
					<Receipt className="size-4 text-[#8a8a8c]" /> Invoice FM-202606-2041
				</div>
				<div className="mt-3 flex gap-1">
					{CHECKS.map((c) => (
						<span key={c} className="h-1 flex-1 rounded-full bg-[#4ade80]" />
					))}
				</div>
				<div className="mt-2 flex justify-between text-[12px]">
					<span className="text-[#4ade80]">All checks passed</span>
					<span className="text-[#8a8a8c]">Recorded</span>
				</div>
			</div>
			<div className="relative -mt-2 h-[170px] overflow-hidden [mask-image:linear-gradient(transparent,black_20%,black_70%,transparent)]">
				<div className="home-marquee-y flex flex-col items-center gap-2 pt-4">
					{[...CHECKS, ...CHECKS].map((c, i) => (
						<span
							key={i}
							className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#1c1c1e] px-3.5 py-1.5 text-[12.5px] text-[#d4d4d6]"
						>
							<Check className="size-3 text-[#4ade80]" /> {c}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

/** A cited answer with its source card. */
export function AnswerMock() {
	return (
		<div className="w-full max-w-[340px] text-left">
			<div className="flex justify-end">
				<span className="rounded-[16px] bg-[#2e2e2e] px-3.5 py-2 text-[13px] text-white">
					How much notice to cancel TechHub?
				</span>
			</div>
			<p className="mt-4 flex items-center gap-1.5 text-[12px] text-[#8a8a8c]">
				<Sparkles className="size-3.5" /> Searched your documents
			</p>
			<p className="mt-2 text-[14px] leading-relaxed text-white">
				60 days, in writing.
				<span className="ml-1.5 inline-flex h-[18px] translate-y-[-1px] items-center gap-1 rounded-[5px] bg-white/[0.06] px-1 align-middle text-[10.5px] text-[#b4b4b6] ring-1 ring-white/10">
					<span className="flex size-3 items-center justify-center rounded-[3px] bg-white/15 text-[8px] text-white">1</span>
					TechHub agreement
				</span>
			</p>
			<div className={`${panel} mt-3`}>
				<div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2 text-[12px]">
					<span className="text-white">Termination · §4</span>
					<span className="flex items-center gap-1 text-[#8a8a8c]">
						<FileText className="size-3" /> Open original
					</span>
				</div>
				<p className="px-3 py-2.5 text-[12px] leading-relaxed text-[#8a8a8c]">
					Either party may terminate this agreement by giving 60 days&apos; written notice.
				</p>
			</div>
		</div>
	);
}

/** A change the agent proposes, waiting for approval. */
export function ProposalMock() {
	return (
		<div className="w-full max-w-[380px] rounded-[18px] border border-white/20 bg-black/35 p-5 text-left backdrop-blur-xl">
			<p className="text-[15px] text-white">Change the category?</p>
			<p className="mt-2 text-[13px] leading-relaxed text-white/80">
				<span className="mr-1.5 rounded-md bg-white/10 px-1.5 py-0.5 text-[12px]">FM-202606-U10223</span>
				Groceries → Shopping. The line items are clothing, not food.
			</p>
			<div className="mt-4 flex items-center justify-between">
				<span className={`${label} text-white/60`}>Low risk</span>
				<span className="flex gap-2">
					<span className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] text-white">Reject</span>
					<span className="rounded-lg bg-white px-3 py-1.5 text-[12px] text-black">Approve</span>
				</span>
			</div>
		</div>
	);
}

/** Ask Lumen on a phone: a short conversation and a question being typed. */
export function ChatPhone() {
	return (
		<Phone>
			<div className="flex h-full flex-col px-5 pt-16 pb-6 text-left">
				<div className="flex-1 space-y-4 overflow-hidden">
					<div className="flex justify-end">
						<span className="rounded-[16px] bg-[#2e2e2e] px-3.5 py-2 text-[13px] text-white">
							Where did we spend the most this quarter?
						</span>
					</div>
					<div className="text-[13px] leading-relaxed text-white">
						<p>Your top three vendors this quarter:</p>
						<div className="mt-2 overflow-hidden rounded-[10px] border border-white/[0.08] text-[12px]">
							{[
								["TechHub Electronics", "₹85,754"],
								["UrbanWear Apparel", "₹66,419"],
								["FreshMart Supermarket", "₹64,091"],
							].map(([v, a]) => (
								<div key={v} className="flex justify-between border-b border-white/[0.06] px-3 py-2 last:border-0">
									<span className="text-[#b4b4b6]">{v}</span>
									<span>{a}</span>
								</div>
							))}
						</div>
					</div>
					<div className="flex justify-end">
						<span className="rounded-[16px] bg-[#2e2e2e] px-3.5 py-2 text-[13px] text-white">
							Is TechHub on contract?
						</span>
					</div>
					<p className="text-[13px] leading-relaxed text-white">
						Yes: an IT maintenance agreement, cancellable with 60 days&apos; notice.
						<span className="ml-1 inline-flex size-4 translate-y-[-1px] items-center justify-center rounded-[4px] bg-white/15 align-middle text-[9px]">
							1
						</span>
					</p>
				</div>
				<div className="mt-4 rounded-[18px] border border-white/10 bg-black p-3">
					<p className="min-h-10 text-[13px] text-white">
						<TypingInput
							questions={[
								"What's my average electricity bill?",
								"Which invoices are waiting for me?",
								"How much did we spend on travel in May?",
							]}
						/>
					</p>
					<div className="mt-2 flex items-center justify-between">
						<span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-[#8a8a8c]">
							<span className="size-1.5 rounded-full bg-[#4ade80]" /> Your invoices and documents
						</span>
						<span className="flex size-7 items-center justify-center rounded-full bg-white text-black">↑</span>
					</div>
				</div>
			</div>
		</Phone>
	);
}
