import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, FileText, Sparkles } from "lucide-react";

// The public landing page. Look: the owner's reference style (near-black gallery canvas, light serif display,
// uppercase mono labels, colour reserved for full-bleed feature tiles, white as the only primary action).
// Static and server-rendered: no client JavaScript.

const description =
	"Lumen reads your invoices, checks them for mistakes and answers questions about your spending and contracts, with the source behind every answer.";

export const metadata: Metadata = {
	title: "Lumen | The AI assistant for accounts payable",
	description,
	alternates: { canonical: "/" },
	openGraph: { url: "/", title: "Lumen | The AI assistant for accounts payable", description },
	twitter: { title: "Lumen | The AI assistant for accounts payable", description },
};

const FEATURES = [
	{
		title: "Reads every invoice",
		body: "Photos, scans and PDFs become structured records: vendor, dates, currency, PO number and every line item.",
		tile: "bg-[#847dff] text-white",
	},
	{
		title: "Checks before it counts",
		body: "Totals that don't add up, duplicates, unknown vendors and hidden instructions are caught and held for review.",
		tile: "bg-[#90b8f0] text-[#0f1011]",
	},
	{
		title: "Answers with sources",
		body: "Ask in plain English. Every answer cites the contract clause or the transactions it came from.",
		tile: "bg-[#dd90d8] text-[#0f1011]",
	},
	{
		title: "Knows your contracts",
		body: "Purchase orders, agreements and policies are searchable alongside your spending.",
		tile: "bg-[#4b49aa] text-white",
	},
	{
		title: "Proposes, never acts",
		body: "Recategorise, flag or mark as paid: Lumen suggests, you approve, and every decision is logged.",
		tile: "bg-[#d1c9ff] text-[#0f1011]",
	},
	{
		title: "Spots the unusual",
		body: "Unusual charges, recurring bills and next month's forecast, without building a single report.",
		tile: "bg-[#2e2e2e] text-[#f5f5f7]",
	},
];

// Results from docs/direction/STORY.md (entries 21 and 22); keep in sync if they're re-measured.
const STATS = [
	{ value: "31/32", label: "spending questions answered correctly" },
	{ value: "0", label: "data leaks or followed injections across 14 attack cases" },
	{ value: "56/56", label: "test invoices read completely right" },
];

const STEPS = [
	{ title: "Bring your invoices", body: "Upload them, drop in a multi-page PDF, or forward them to a mailbox Lumen watches." },
	{ title: "Lumen checks and files", body: "Clean invoices are recorded at once; doubtful ones wait in a review queue with the reason." },
	{ title: "Ask anything", body: "Spending, vendors, contract terms: answers arrive with the evidence attached." },
];

function PrimaryCta({ children }: { children: React.ReactNode }) {
	return (
		<Link
			href="/signin"
			className="inline-flex items-center gap-2 rounded-lg bg-white px-[18px] py-3 text-[15px] text-black transition-opacity duration-200 hover:opacity-90"
		>
			{children}
			<ArrowRight className="size-4" />
		</Link>
	);
}

function ProductPreview() {
	return (
		<div
			aria-hidden
			className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f1011]/90 p-5 text-left backdrop-blur-xl sm:p-7"
		>
			<div className="flex justify-end">
				<span className="rounded-[18px] bg-[#2e2e2e] px-4 py-2.5 text-[14px] text-[#f5f5f7]">
					What&apos;s the notice period in the TechHub contract?
				</span>
			</div>
			<div className="mt-5 flex items-center gap-2 text-[13px] text-[#9f9fa0]">
				<Sparkles className="size-4 text-[#6a6b6b]" />
				Used 1 step · 2.1s
			</div>
			<p className="mt-2 text-[15px] leading-relaxed text-[#f5f5f7]">
				Either party can end the agreement with <strong className="font-medium">60 days&apos; written notice</strong>.
				<span className="ml-1.5 inline-flex h-[18px] translate-y-[-1px] items-center gap-1 rounded-[5px] bg-[#161718] px-1 align-middle text-[10.5px] text-[#9f9fa0] ring-1 ring-white/10">
					<span className="flex size-3 items-center justify-center rounded-[3px] bg-[#2e2e2e] text-[8px] text-white">1</span>
					TechHub maintenance agreement
				</span>
			</p>
			<div className="mt-4 rounded-[10px] ring-1 ring-white/10">
				<div className="flex items-center gap-2.5 border-b border-white/10 px-3 py-2.5 text-[13px]">
					<span className="text-[#f5f5f7]">TechHub Electronics IT equipment maintenance agreement</span>
					<span className="hidden text-[#6a6b6b] sm:inline">Termination</span>
					<span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#161718] px-2 py-0.5 text-[12px] text-[#9f9fa0] ring-1 ring-white/15">
						<FileText className="size-3" /> Open original
					</span>
				</div>
				<p className="px-3 py-2.5 text-[12.5px] text-[#9f9fa0]">
					Either party may terminate this agreement by giving 60 days&apos; written notice.
				</p>
			</div>
		</div>
	);
}

export default function HomePage() {
	return (
		<div className="bui min-h-screen">
			{/* nav: frosted glass over the canvas */}
			<header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#0f1011]/60 backdrop-blur-[24px]">
				<nav className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5">
					<Link href="/" className="flex items-center gap-2 text-[16px] text-white">
						<Image src="/lumen_logo.svg" alt="" width={26} height={26} priority />
						Lumen
					</Link>
					<div className="hidden items-center gap-1 md:flex">
						{[
							["Features", "#features"],
							["Results", "#results"],
							["How it works", "#how"],
						].map(([label, href]) => (
							<a
								key={href}
								href={href}
								className="rounded-lg px-3 py-2 text-[14px] text-[#9f9fa0] transition-colors duration-200 hover:text-white"
							>
								{label}
							</a>
						))}
					</div>
					<div className="ml-auto flex items-center gap-4">
						<Link href="/signin" className="text-[14px] text-[#9f9fa0] transition-colors duration-200 hover:text-white">
							Log in
						</Link>
						<Link
							href="/signin"
							className="rounded-lg bg-white px-3.5 py-2 text-[14px] text-black transition-opacity duration-200 hover:opacity-90"
						>
							Try the demo
						</Link>
					</div>
				</nav>
			</header>

			<main>
				{/* hero: headline over a night-sky gradient, the product rising from the horizon */}
				<section
					className="relative overflow-hidden px-5 pt-36 pb-24 sm:pt-44"
					style={{
						background:
							"linear-gradient(rgb(15,16,17), rgb(19,29,39) 30%, rgb(26,71,136) 62%, rgb(64,138,193) 86%, rgb(15,16,17) 100%)",
					}}
				>
					<div className="mx-auto flex max-w-[1200px] flex-col items-center text-center">
						<span className="bui-label rounded-full border border-white/15 bg-white/10 px-5 py-2 text-white">
							AI assistant for accounts payable
						</span>
						<h1 className="mt-8 font-display text-[52px] leading-[0.95] font-light text-white sm:text-[80px] lg:text-[96px]">
							Every invoice,
							<br />
							<em>answered</em>.
						</h1>
						<p className="mt-7 max-w-[560px] text-[18px] leading-[1.5] font-light text-[#9f9fa0]">{description}</p>
						<div className="mt-9 flex items-center gap-5">
							<PrimaryCta>Try the demo</PrimaryCta>
							<span className="bui-label text-[#9f9fa0]">No sign-up</span>
						</div>
					</div>
					<div className="mt-20">
						<ProductPreview />
					</div>
				</section>

				{/* features: colour carries each tile */}
				<section id="features" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-20">
					<span className="bui-label block text-center text-[#9f9fa0]">What it does</span>
					<h2 className="mt-5 text-center font-display text-[38px] leading-none font-light text-[#f5f5f7] sm:text-[56px]">
						The paperwork, <em>handled</em>.
					</h2>
					<div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{FEATURES.map((f) => (
							<article key={f.title} className={`flex min-h-64 flex-col justify-between rounded-[30px] p-8 ${f.tile}`}>
								<h3 className="font-display text-[34px] leading-[0.95] font-light">{f.title}</h3>
								<p className="mt-8 text-[16px] leading-[1.5] opacity-90">{f.body}</p>
							</article>
						))}
					</div>
				</section>

				{/* results: the one inverted card */}
				<section id="results" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-12">
					<div className="rounded-[30px] bg-[#cacaca] p-8 text-black sm:p-12">
						<span className="bui-label text-black/60">Measured, not claimed</span>
						<h2 className="mt-4 max-w-2xl font-display text-[38px] leading-none font-light sm:text-[48px]">
							Every claim on this page is a <em>test result</em>.
						</h2>
						<dl className="mt-12 grid gap-10 sm:grid-cols-3">
							{STATS.map((s) => (
								<div key={s.label} className="border-t border-black/20 pt-5">
									<dt className="font-display text-[56px] leading-none font-light">{s.value}</dt>
									<dd className="mt-3 text-[15px] leading-snug text-black/70">{s.label}</dd>
								</div>
							))}
						</dl>
						<p className="bui-label mt-10 text-[10px] text-black/50">Measured on Lumen&apos;s own labelled test sets</p>
					</div>
				</section>

				{/* how it works */}
				<section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-20">
					<span className="bui-label block text-center text-[#9f9fa0]">How it works</span>
					<h2 className="mt-5 text-center font-display text-[38px] leading-none font-light text-[#f5f5f7] sm:text-[56px]">
						Three steps, <em>no setup</em>.
					</h2>
					<ol className="mt-14 grid gap-3 md:grid-cols-3">
						{STEPS.map((step, i) => (
							<li key={step.title} className="rounded-2xl bg-[#161718] p-8 ring-1 ring-white/5">
								<span className="bui-label text-[#6a6b6b]">0{i + 1}</span>
								<h3 className="mt-6 text-[18px] font-light text-white">{step.title}</h3>
								<p className="mt-2 text-[15px] leading-[1.6] text-[#9f9fa0]">{step.body}</p>
							</li>
						))}
					</ol>
				</section>

				{/* closing call to action */}
				<section className="px-5 pt-12 pb-28 text-center">
					<h2 className="font-display text-[44px] leading-none font-light text-white sm:text-[72px]">
						See it with <em>your</em> questions.
					</h2>
					<p className="mx-auto mt-6 max-w-md text-[18px] leading-[1.5] font-light text-[#9f9fa0]">
						A private demo workspace with a year of sample invoices and contracts, ready in one click.
					</p>
					<ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] text-[#9f9fa0]">
						{["No sign-up", "Your own private copy", "Real AI answers"].map((item) => (
							<li key={item} className="flex items-center gap-1.5">
								<Check className="size-4 text-white" /> {item}
							</li>
						))}
					</ul>
					<div className="mt-10">
						<PrimaryCta>Try the demo</PrimaryCta>
					</div>
				</section>
			</main>

			<footer className="border-t border-white/5">
				<div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
					<span className="flex items-center gap-2 text-[14px] text-[#9f9fa0]">
						<Image src="/lumen_logo.svg" alt="" width={20} height={20} />
						Lumen
					</span>
					<span className="bui-label text-[10px] text-[#6a6b6b]">© 2026 Lumen</span>
				</div>
			</footer>
		</div>
	);
}
