// Product mockups for the landing page: polished showcase versions of Lumen's screens, with sample data.
import type { ReactNode } from "react";
import { CalendarClock, Check, CreditCard, Home, Receipt, Sparkles, TrendingDown } from "lucide-react";

export const label = "font-[family-name:var(--font-roboto-mono)] text-[10.5px] font-medium tracking-[0.16em] uppercase";

/** Dark inner panel with a mono header and a sparkle button, the frame most showcase screens sit in. */
function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
	return (
		<div className={`w-full overflow-hidden rounded-[18px] border border-white/[0.06] bg-[#18181a] ${className}`}>
			<div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
				<span className={`${label} text-[#d4d4d6]`}>{title}</span>
				<span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.05]">
					<Sparkles className="size-4 text-[#8f88ff]" fill="#8f88ff" strokeWidth={1} />
				</span>
			</div>
			{children}
		</div>
	);
}

export function Phone({ children, glass = false }: { children: ReactNode; glass?: boolean }) {
	return (
		<div
			className={`relative mx-auto h-[700px] w-[340px] rounded-[58px] border-[10px] border-[#1d1d1f] shadow-[0_0_0_2px_#3a3a3c,0_40px_80px_rgb(0_0_0/0.35)] ${
				glass ? "bg-white/[0.04] backdrop-blur-[2px]" : "bg-[#0b0b0c]"
			}`}
		>
			<span className="absolute top-3 left-1/2 z-20 h-7 w-28 -translate-x-1/2 rounded-full bg-[#0b0b0c]" />
			<div className="absolute inset-0 overflow-hidden rounded-[48px]">{children}</div>
		</div>
	);
}

const HERO_CARDS = [
	["Subscriptions", "Three plans you forgot about.", "Two streaming plans and an old cloud backup cost you ₹1,850 a month. Cancel them in a tap."],
	["Savings", "Your cash is sitting still.", "₹2.4 lakh in your savings account earns next to nothing. Put to work, it could earn about ₹16,000 more a year."],
	["Bills", "Electricity jumped 32%.", "This month's bill is well above your usual. Lumen spotted a tariff change on page 2."],
	["Charges", "Same bill, charged twice.", "FreshMart billed you twice for one order this week. The duplicate is flagged for a refund."],
] as const;

/** Glass cards cycling inside the hero phone. */
export function HeroPhone() {
	return (
		<Phone glass>
			<div className="flex flex-col items-center px-6 pt-20 text-center">
				<span className="flex size-11 items-center justify-center rounded-xl border border-white/30 bg-white/15 text-white backdrop-blur">
					<Sparkles className="size-5" strokeWidth={1.5} />
				</span>
				<p className="mt-5 font-display text-[30px] leading-[1.1] font-light text-white">
					We found 9 ways to save you ₹42,300 this year
				</p>
				<div className="home-cycle relative mt-8 h-[200px] w-full">
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

// --- feature carousel screens -------------------------------------------------------------------------------

export function SpendingMock() {
	return (
		<Panel title="Spending · October">
			<div className="px-5 pt-5">
				<p className="text-[34px] leading-none tracking-tight text-white">₹1,24,560</p>
				<p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[#4ade80]/10 px-2 py-1 text-[12px] text-[#4ade80]">
					<TrendingDown className="size-3.5" /> ₹8,200 less than September
				</p>
			</div>
			<svg viewBox="0 0 320 130" className="mt-2 w-full">
				<defs>
					<linearGradient id="spend-fill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#00b3dd" stopOpacity="0.35" />
						<stop offset="1" stopColor="#00b3dd" stopOpacity="0" />
					</linearGradient>
				</defs>
				<path d="M0 104 C 30 98 50 70 80 74 S 130 58 160 60 S 220 40 250 46 S 300 30 320 26" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="1.5" strokeDasharray="4 5" />
				<path d="M0 112 C 30 108 50 92 80 90 S 130 78 160 80 S 210 64 240 66 L 240 130 L 0 130 Z" fill="url(#spend-fill)" />
				<path d="M0 112 C 30 108 50 92 80 90 S 130 78 160 80 S 210 64 240 66" fill="none" stroke="#00b3dd" strokeWidth="2.5" />
				<circle cx="240" cy="66" r="4" fill="#00b3dd" stroke="#18181a" strokeWidth="2" />
			</svg>
			<div className={`${label} flex justify-between px-5 pb-4 text-[9.5px] text-[#6a6b6b]`}>
				<span>Oct 1</span>
				<span>Oct 15</span>
				<span>Oct 31</span>
			</div>
		</Panel>
	);
}

export function BudgetMock() {
	// 270° arc, 62% used
	return (
		<Panel title="Budget">
			<div className="flex flex-col items-center px-5 pt-5">
				<div className="relative">
					<svg viewBox="0 0 200 170" className="w-[190px]">
						<defs>
							<linearGradient id="budget-arc" x1="0" y1="1" x2="1" y2="0">
								<stop offset="0" stopColor="#4b49aa" />
								<stop offset="1" stopColor="#00b3dd" />
							</linearGradient>
						</defs>
						<path d="M45 150 A 78 78 0 1 1 155 150" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="10" strokeLinecap="round" />
						<path d="M45 150 A 78 78 0 1 1 155 150" fill="none" stroke="url(#budget-arc)" strokeWidth="10" strokeLinecap="round" strokeDasharray="368" strokeDashoffset="140" />
					</svg>
					<div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
						<span className="text-[11px] text-[#8a8a8c]">Left to spend</span>
						<span className="text-[30px] leading-tight tracking-tight text-white">₹18,400</span>
						<span className="text-[11px] text-[#8a8a8c]">of ₹60,000</span>
					</div>
				</div>
				<span className="-mt-3 rounded-md bg-[#4ade80]/10 px-2 py-1 text-[11.5px] text-[#4ade80]">+₹2,000 rolled over</span>
			</div>
			<div className="mt-4 space-y-px px-3 pb-3 text-[13px]">
				{[
					["Monthly income", "", "₹1,20,000"],
					["Save", "20%", "₹24,000"],
					["Spend", "50%", "₹60,000"],
				].map(([k, pct, v]) => (
					<div key={k} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
						<span className="text-[#b4b4b6]">{k}</span>
						<span className="text-white">
							{pct && <span className="mr-2 text-[#6a6b6b]">{pct}</span>}
							{v}
						</span>
					</div>
				))}
			</div>
		</Panel>
	);
}

type Charge = { day: number; who?: [string, string][]; amount?: string };
const CALENDAR: Charge[] = [
	{ day: 27 }, { day: 28 }, { day: 29, who: [["#e50914", "N"]], amount: "₹649" }, { day: 30 },
	{ day: 1, who: [["#1db954", "S"], ["#0a84ff", "A"]], amount: "₹718" }, { day: 2 }, { day: 3, who: [["#ff0033", "Y"]], amount: "₹129" },
	{ day: 4, who: [["#8b5cf6", "G"]], amount: "₹1,499" }, { day: 5 }, { day: 6, who: [["#f5a35c", "D"]], amount: "₹299" }, { day: 7 },
	{ day: 8 }, { day: 9, who: [["#22c55e", "C"]], amount: "₹99" }, { day: 10 },
];

export function SubscriptionsMock() {
	return (
		<Panel title="Upcoming charges">
			<div className="p-4">
				<div className={`${label} grid grid-cols-7 pb-2 text-center text-[9px] text-[#6a6b6b]`}>
					{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
						<span key={i}>{d}</span>
					))}
				</div>
				<div className="grid grid-cols-7 overflow-hidden rounded-xl border border-white/[0.06]">
					{CALENDAR.map((c, i) => (
						<div key={i} className="flex h-[64px] flex-col items-center gap-1 border-r border-b border-white/[0.05] pt-1.5 text-[11px] text-[#8a8a8c] [&:nth-child(7n)]:border-r-0">
							<span className={c.who ? "text-white" : ""}>{c.day}</span>
							{c.who && (
								<span className="flex -space-x-1">
									{c.who.map(([color, letter]) => (
										<span key={letter} className="flex size-4 items-center justify-center rounded-full text-[8px] font-semibold text-white ring-1 ring-[#18181a]" style={{ background: color }}>
											{letter}
										</span>
									))}
								</span>
							)}
							{c.amount && <span className="text-[9.5px] text-[#b4b4b6]">{c.amount}</span>}
						</div>
					))}
				</div>
				<p className="mt-3 text-[12px] text-[#8a8a8c]">
					7 subscriptions · <span className="text-white">₹3,493 / month</span>
				</p>
			</div>
		</Panel>
	);
}

export function InvoiceMock() {
	return (
		<Panel title="Bill · read from photo">
			<dl className="space-y-2.5 px-5 pt-4 text-[13px]">
				{[
					["Merchant", "FreshMart Supermarket"],
					["Date", "12 Oct 2026"],
					["Paid with", "HDFC card ·· 4410"],
				].map(([k, v]) => (
					<div key={k} className="flex justify-between gap-3">
						<dt className="text-[#8a8a8c]">{k}</dt>
						<dd className="truncate text-white">{v}</dd>
					</div>
				))}
			</dl>
			<div className="mx-5 mt-4 space-y-2 rounded-xl bg-white/[0.03] p-3 text-[12.5px] text-[#b4b4b6]">
				{[
					["Basmati rice 5kg × 2", "₹1,080"],
					["Olive oil 1L × 2", "₹1,560"],
					["Fresh produce", "₹825"],
				].map(([k, v]) => (
					<div key={k} className="flex justify-between">
						<span>{k}</span>
						<span className="text-white">{v}</span>
					</div>
				))}
			</div>
			<div className="flex items-center justify-between px-5 py-4">
				<span className="flex items-center gap-1.5 text-[12px] text-[#4ade80]">
					<Check className="size-3.5" /> Totals add up
				</span>
				<span className="text-[18px] text-white">₹3,465</span>
			</div>
		</Panel>
	);
}

export function ForecastMock() {
	return (
		<Panel title="Next 3 months">
			<div className="px-5 pt-5">
				<p className="text-[12px] text-[#8a8a8c]">Expected spend in November</p>
				<p className="mt-1 text-[30px] leading-none tracking-tight text-white">₹1,42,000</p>
			</div>
			<svg viewBox="0 0 320 150" className="mt-3 w-full">
				<defs>
					<linearGradient id="fc-band" x1="0" y1="0" x2="1" y2="0">
						<stop offset="0" stopColor="#847dff" stopOpacity="0.05" />
						<stop offset="1" stopColor="#847dff" stopOpacity="0.3" />
					</linearGradient>
				</defs>
				{[30, 70, 110].map((y) => (
					<line key={y} x1="0" x2="320" y1={y} y2={y} stroke="rgb(255 255 255 / 0.05)" />
				))}
				<path d="M190 70 L320 30 L320 92 Z" fill="url(#fc-band)" />
				<path d="M0 108 L40 96 L80 102 L120 84 L160 88 L190 70" fill="none" stroke="#f5f5f7" strokeWidth="2" />
				<path d="M190 70 L255 56 L320 60" fill="none" stroke="#a49eff" strokeWidth="2" strokeDasharray="5 5" />
				<circle cx="190" cy="70" r="4" fill="#f5f5f7" stroke="#18181a" strokeWidth="2" />
				<line x1="190" x2="190" y1="0" y2="150" stroke="rgb(255 255 255 / 0.12)" strokeDasharray="2 4" />
			</svg>
			<div className="flex gap-4 px-5 pb-4 text-[11.5px] text-[#8a8a8c]">
				<span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#f5f5f7]" /> Actual</span>
				<span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#a49eff]" /> Forecast</span>
			</div>
		</Panel>
	);
}

export function SavingsMock() {
	return (
		<Panel title="Idle cash">
			<div className="grid grid-cols-3 gap-2 px-5 pt-5 text-[11px] text-[#8a8a8c]">
				<div>
					<p>Sitting idle</p>
					<p className="mt-1 text-[20px] text-white">₹2.4L</p>
				</div>
				<div className="border-l border-white/[0.08] pl-3">
					<p>Could earn</p>
					<p className="mt-1 text-[20px] text-[#f0b429]">7.0%</p>
				</div>
				<div className="border-l border-white/[0.08] pl-3">
					<p>Extra / year</p>
					<p className="mt-1 text-[20px] text-[#f0b429]">₹16K</p>
				</div>
			</div>
			<svg viewBox="0 0 320 140" className="mt-4 w-full">
				<defs>
					<linearGradient id="save-fill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="#f0b429" stopOpacity="0.32" />
						<stop offset="1" stopColor="#f0b429" stopOpacity="0" />
					</linearGradient>
				</defs>
				<path d="M0 120 C 90 112 170 96 230 70 S 300 20 320 8 L320 140 L0 140 Z" fill="url(#save-fill)" />
				<path d="M0 120 C 90 112 170 96 230 70 S 300 20 320 8" fill="none" stroke="#f0b429" strokeWidth="2.5" />
				<path d="M0 124 L320 108" fill="none" stroke="rgb(255 255 255 / 0.3)" strokeWidth="1.5" strokeDasharray="4 5" />
			</svg>
			<div className="flex justify-center gap-4 pb-4 text-[11.5px] text-[#8a8a8c]">
				<span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[#f0b429]" /> Put to work</span>
				<span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-white/40" /> Left idle</span>
			</div>
		</Panel>
	);
}

// --- always-on notifications ---------------------------------------------------------------------------------

const NOTIFICATIONS = [
	[CreditCard, "Your card statement closes in 6 days. Paying ₹8,000 now keeps you under 30% usage.", "1m ago"],
	[CalendarClock, "Your gym membership renews Friday. You haven't checked in since July.", "12m ago"],
	[Home, "Rent took 34% of your income this month, a little above the healthy mark.", "1h ago"],
	[Receipt, "FreshMart charged you twice for one order. The duplicate is flagged.", "3h ago"],
] as const;

/** A stack of notification cards; the front one cycles. */
export function Notifications() {
	const card =
		"rounded-[30px] border border-white/[0.09] bg-[linear-gradient(180deg,#323234_0%,#1f1f21_100%)] shadow-[0_24px_60px_rgb(0_0_0/0.45)]";
	return (
		<div className="relative mx-auto h-[150px] w-full max-w-[640px] pt-6">
			<div className={`${card} absolute inset-x-[10%] top-0 h-[110px] opacity-35`} />
			<div className={`${card} absolute inset-x-[5%] top-3 h-[110px] opacity-60`} />
			<div className="home-cycle absolute inset-x-0 top-6 h-[120px]">
				{NOTIFICATIONS.map(([Icon, text, when]) => (
					<div key={text} className={`${card} absolute inset-0 flex items-center gap-5 px-7 sm:px-9`}>
						<Icon className="size-7 shrink-0 text-[#9f9fa0]" strokeWidth={1.3} />
						<span className="flex-1 text-left text-[16px] leading-snug text-white sm:text-[19px]">{text}</span>
						<span className="hidden shrink-0 text-[14px] text-[#6a6b6b] sm:inline">{when}</span>
					</div>
				))}
			</div>
		</div>
	);
}

// --- scene + screen pairs ------------------------------------------------------------------------------------

const INSIGHTS: [string, string, string, string][] = [
	["Credit usage", "24%", "Healthy", "#4ade80"],
	["Cash flow", "+₹18,200", "This month", "#4ade80"],
	["Savings rate", "21%", "Above target", "#4ade80"],
	["Subscriptions", "7", "₹3,493 / month", "#f5a35c"],
	["Top category", "Dining", "₹14,800", "#a49eff"],
	["Upcoming bills", "4", "This week", "#00b3dd"],
	["Rent share", "34%", "Above 30%", "#f87171"],
	["Net worth", "₹8.6L", "+2.1% this month", "#4ade80"],
];

function InsightRow({ reverse = false }: { reverse?: boolean }) {
	const items = reverse ? [...INSIGHTS].reverse() : INSIGHTS;
	return (
		<div className={`flex w-max gap-3 ${reverse ? "home-marquee-x-rev" : "home-marquee-x"}`}>
			{[...items, ...items].map(([name, value, note, color], i) => (
				<div key={i} className="w-[200px] shrink-0 rounded-[16px] border border-white/[0.06] bg-[#18181a] p-4">
					<span className={`${label} text-[9.5px] text-[#8a8a8c]`}>{name}</span>
					<p className="mt-3 text-[24px] leading-none tracking-tight text-white">{value}</p>
					<p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#8a8a8c]">
						<span className="size-1.5 rounded-full" style={{ background: color }} /> {note}
					</p>
				</div>
			))}
		</div>
	);
}

/** Two rows of insight cards sliding past in opposite directions. */
export function InsightMarquee() {
	return (
		<div className="flex w-full flex-col gap-3 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
			<InsightRow />
			<InsightRow reverse />
		</div>
	);
}

const CHECKS: [string, boolean][] = [
	["Saving more than 20% of income", true],
	["Rent under 30% of income", false],
	["No duplicate charges", true],
	["Bills paid on time", true],
	["Spending pacing over budget", false],
	["Emergency fund covers 3 months", true],
	["Loan payments under 15% of income", true],
];

/** Money checks scrolling past under a cash-flow summary. */
export function ChecksMock() {
	return (
		<div className="w-full max-w-[340px]">
			<div className="relative z-10 rounded-[16px] border border-white/[0.07] bg-[linear-gradient(180deg,#232325,#18181a)] p-5">
				<div className="flex items-center gap-2 text-[15px] text-white">
					<span className="flex size-7 items-center justify-center rounded-full border border-white/15">
						<Sparkles className="size-3.5" strokeWidth={1.5} />
					</span>
					Cash flow
				</div>
				<div className="mt-4 flex gap-1">
					{["#f87171", "#f5a35c", "#f0b429", "#4ade80", "#4ade80", "#4ade80"].map((c, i) => (
						<span key={i} className="h-1 flex-1 rounded-full" style={{ background: c, opacity: i < 3 ? 0.35 : 1 }} />
					))}
				</div>
				<div className="mt-2 flex justify-between text-[12px]">
					<span className="text-[#4ade80]">88%</span>
					<span className="text-[#8a8a8c]">2 actions</span>
				</div>
			</div>
			<div className="relative -mt-2 h-[190px] overflow-hidden [mask-image:linear-gradient(transparent,black_20%,black_70%,transparent)]">
				<div className="home-marquee-y flex flex-col items-center gap-2 pt-4">
					{[...CHECKS, ...CHECKS].map(([text, ok], i) => (
						<span key={i} className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#1c1c1e] px-4 py-2 text-[13px] text-[#e4e4e6]">
							<span className={`size-1.5 rounded-full ${ok ? "bg-[#4ade80]" : "bg-[#f87171]"}`} /> {text}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

/** Money health gauge, a summary and the top action. */
export function GuideMock() {
	return (
		<div className="w-full max-w-[360px]">
			<div className="flex justify-center">
				<div className="relative">
					<svg viewBox="0 0 120 120" className="w-[130px] -rotate-90">
						<circle cx="60" cy="60" r="50" fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="7" />
						{[
							["#f87171", 0, 70],
							["#f0b429", 75, 70],
							["#14b8a6", 150, 75],
						].map(([color, offset, len]) => (
							<circle
								key={color as string}
								cx="60"
								cy="60"
								r="50"
								fill="none"
								stroke={color as string}
								strokeWidth="7"
								strokeLinecap="round"
								strokeDasharray={`${len} 400`}
								strokeDashoffset={-(offset as number)}
							/>
						))}
					</svg>
					<span className="absolute inset-0 flex items-center justify-center font-display text-[30px] font-light text-white">72</span>
				</div>
			</div>
			<div className="mt-4 rounded-[16px] border border-white/[0.07] bg-[#18181a] p-4">
				<p className="flex items-center gap-2 text-[14px] text-white">
					<Sparkles className="size-4 text-[#8f88ff]" fill="#8f88ff" strokeWidth={1} /> Summary
				</p>
				<p className="mt-2 text-[13px] leading-relaxed text-[#b4b4b6]">
					Aarav, your biggest win this month is putting ₹40,000 of idle cash to work.
				</p>
			</div>
			<div className="mt-2 rounded-[16px] border border-white/[0.07] bg-[linear-gradient(180deg,#232349,#18181a_70%)] p-4">
				<span className={`${label} text-[9.5px] text-[#a49eff]`}>Subscriptions</span>
				<p className="mt-2 text-[15px] text-white">Free up ₹2,100 a month</p>
				<p className="mt-1 text-[12.5px] leading-relaxed text-[#8a8a8c]">
					Three plans haven&apos;t been used since summer. Cancelling them pays for your phone bill.
				</p>
			</div>
		</div>
	);
}

