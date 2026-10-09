import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, FileCheck2, Lock, Quote, ShieldCheck, Sparkles, UserCheck, type LucideIcon } from "lucide-react";
import "./home.css";
import { FeatureCarousel, type FeatureCard } from "@/components/home/feature-carousel";
import {
	AnomalyMock,
	AnswerMock,
	ChatPhone,
	ChecksMock,
	DocMarquee,
	DocsMock,
	FlagsMock,
	ForecastMock,
	HeroPhone,
	InvoiceMock,
	Notifications,
	ProposalMock,
	SpendMock,
} from "@/components/home/mocks";
import { Reveal } from "@/components/home/reveal";
import { Hills, Scene, Sky } from "@/components/home/scenes";

// The public landing page, modelled on the owner's reference (useorigin.com): light serif display with an italic
// word, mono uppercase UI labels, near-black canvas, photo-like scenes, product screens in motion.

const description =
	"Lumen reads every invoice, catches what doesn't add up, and answers questions about your spending and contracts, with the source for every answer.";

export const metadata: Metadata = {
	title: "Lumen | Your AI finance assistant",
	description,
	alternates: { canonical: "/" },
	openGraph: { url: "/", title: "Lumen | Your AI finance assistant", description },
	twitter: { title: "Lumen | Your AI finance assistant", description },
};

const mono = "font-[family-name:var(--font-roboto-mono)] uppercase tracking-[0.06em]";

function Cta({ children, variant = "light" }: { children: ReactNode; variant?: "light" | "dark" }) {
	return (
		<Link
			href="/signin"
			className={`${mono} inline-flex items-center gap-2 rounded-lg px-[18px] py-3 text-[12px] font-medium transition-opacity duration-200 hover:opacity-85 ${
				variant === "light" ? "bg-white text-black" : "bg-[#1c1c1e] text-white ring-1 ring-white/10"
			}`}
		>
			{children}
			{variant === "light" && <ArrowRight className="size-3.5" />}
		</Link>
	);
}

/** Serif headline whose lines rise into place as it scrolls in. */
function Headline({ lines, size = "text-[44px] sm:text-[64px] lg:text-[80px]" }: { lines: ReactNode[]; size?: string }) {
	return (
		<Reveal className="home-lines">
			<h2
				className={`font-display leading-[1.02] font-light tracking-[-0.01em] text-white ${size}`}
			>
				{lines.map((line, i) => (
					<span key={i} className="block overflow-hidden pb-[0.06em]">
						<span className="ln" style={{ transitionDelay: `${i * 120}ms` }}>
							{line}
						</span>
					</span>
				))}
			</h2>
		</Reveal>
	);
}

const FEATURES: FeatureCard[] = [
	{ title: "Read any invoice", body: "Photos, scans and multi-page PDFs become clean records, line items included.", mock: <InvoiceMock /> },
	{ title: "Catch mistakes early", body: "Wrong totals, duplicates and unknown vendors are flagged before they're recorded.", mock: <FlagsMock /> },
	{ title: "Keep contracts close", body: "Purchase orders, agreements and policies, searchable right next to your spending.", mock: <DocsMock /> },
	{ title: "See where money goes", body: "Spending by category, vendor and month, without building a single report.", mock: <SpendMock /> },
	{ title: "Forecast what's next", body: "See next month's likely spend before the invoices arrive.", mock: <ForecastMock /> },
	{ title: "Spot the unusual", body: "Charges that don't fit your pattern surface on their own.", mock: <AnomalyMock /> },
];

const PROMISES: [LucideIcon, string][] = [
	[Quote, "Cites every source"],
	[UserCheck, "You approve every change"],
	[Lock, "Private to your account"],
	[FileCheck2, "PDFs, scans and photos"],
];

const QUESTIONS: [string, string][] = [
	["Spending", "Where did we spend the most this quarter?"],
	["Contracts", "What does the NetLink contract cost each month?"],
	["Invoices", "List every FreshMart invoice from June."],
	["Spending", "What's our average electricity bill?"],
	["Contracts", "How much notice do we need to cancel TechHub?"],
	["Forecast", "What will next month's spend look like?"],
	["Invoices", "Did anyone bill us twice this month?"],
	["Policy", "Does our expense policy cover client dinners?"],
	["Spending", "How did travel compare with last month?"],
];

function Pair({ scene, title, body, children, flip = false }: {
	scene: "dune" | "meadow" | "dusk";
	title: ReactNode[];
	body: string;
	children: ReactNode;
	flip?: boolean;
}) {
	const photo = (
		<Reveal>
			<div className="relative flex min-h-[520px] flex-col justify-between overflow-hidden rounded-[24px] p-10 text-center">
				<Scene name={scene} />
				<div className="relative mt-10">
					<Headline lines={title} size="text-[44px] sm:text-[64px]" />
				</div>
				<p className="relative mx-auto max-w-sm text-[17px] leading-[1.5] text-white">{body}</p>
			</div>
		</Reveal>
	);
	const screen = (
		<Reveal delay={150}>
			<div className="flex min-h-[520px] items-center justify-center overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#0e0e0f] p-8">
				{children}
			</div>
		</Reveal>
	);
	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
			{flip ? screen : photo}
			{flip ? photo : screen}
		</div>
	);
}

export default function HomePage() {
	return (
		<div className="min-h-screen bg-[#050505] text-white antialiased">
			{/* nav: frosted glass */}
			<header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.04] bg-[#0f1011]/[0.08] backdrop-blur-[24px]">
				<nav className="mx-auto flex h-[68px] max-w-[1440px] items-center px-5 sm:px-8">
					<Link href="/" aria-label="Lumen home" className="flex items-center gap-2.5">
						<Image src="/lumen_logo.svg" alt="" width={28} height={28} priority />
						<span className="text-[17px] tracking-tight text-white">Lumen</span>
					</Link>
					<div className="absolute left-1/2 hidden -translate-x-1/2 gap-1.5 md:flex">
						{[
							["Features", "#features"],
							["How it works", "#how"],
							["Ask Lumen", "#ask"],
						].map(([text, href]) => (
							<a
								key={href}
								href={href}
								className={`${mono} rounded-lg bg-white/[0.07] px-3 py-2 text-[11.5px] font-medium text-white transition-colors duration-200 hover:bg-white/15`}
							>
								{text}
							</a>
						))}
					</div>
					<div className="ml-auto flex items-center gap-5">
						<Link href="/signin" className={`${mono} hidden text-[11.5px] font-medium text-white sm:inline`}>
							Log in
						</Link>
						<Cta>Get started</Cta>
					</div>
				</nav>
			</header>

			<main>
				{/* hero: sky, headline, phone rising from the bottom */}
				<section className="relative overflow-hidden pt-[150px]">
					<Sky />
					<div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-5 text-center">
						<Reveal>
							<span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 py-1.5 pr-1.5 pl-4 text-[13px] text-white backdrop-blur">
								Try it free
								<span className={`${mono} rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-medium`}>No sign-up</span>
							</span>
						</Reveal>
						<div className="mt-7">
							<Reveal className="home-lines">
								<h1 className="font-display text-[52px] leading-[1.05] font-light tracking-[-0.01em] sm:text-[80px] lg:text-[96px]">
									<span className="block overflow-hidden pb-[0.06em]">
										<span className="ln">
											Meet your <em>meticulous</em>
										</span>
									</span>
									<span className="block overflow-hidden pb-[0.06em]">
										<span className="ln" style={{ transitionDelay: "120ms" }}>
											AI finance assistant.
										</span>
									</span>
								</h1>
							</Reveal>
						</div>
						<Reveal delay={250}>
							<p className="mx-auto mt-6 max-w-[520px] text-[17px] leading-[1.5] text-white/80">{description}</p>
							<div className="mt-8">
								<Cta>Get started</Cta>
							</div>
						</Reveal>
						<div className="mt-16 -mb-[220px] w-full">
							<Reveal delay={350}>
								<HeroPhone />
							</Reveal>
						</div>
					</div>
				</section>

				{/* promise panel with a horizon glow */}
				<section className="relative z-10 bg-[#050505] px-4 pt-4 sm:px-5">
					<div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[24px] border border-white/[0.05] bg-[#0b0b0c] px-6 pt-28 pb-24 text-center">
						<div
							aria-hidden
							className="absolute inset-x-0 bottom-0 h-[70%]"
							style={{
								background:
									"radial-gradient(60% 55% at 50% 100%, rgb(160 205 235 / 0.55) 0%, rgb(40 110 170 / 0.35) 35%, transparent 72%)",
							}}
						/>
						<div className="relative">
							<Headline lines={[<>You shouldn&apos;t have to <em>chase</em></>, "paperwork."]} size="text-[40px] sm:text-[56px]" />
							<Reveal delay={150}>
								<p className="mx-auto mt-5 max-w-md text-[16px] leading-[1.5] text-[#9f9fa0]">
									Lumen does the reading, checking and filing, and only asks for you when something needs a decision.
								</p>
							</Reveal>
							<Reveal delay={250}>
								<ul className="mx-auto mt-12 flex max-w-5xl flex-wrap justify-center gap-x-12 gap-y-6">
									{PROMISES.map(([Icon, text]) => (
										<li key={text} className="flex flex-col items-center gap-2.5">
											<Icon className="size-5 text-white" strokeWidth={1.5} />
											<span className={`${mono} text-[10.5px] font-medium tracking-[0.12em] text-white/85`}>{text}</span>
										</li>
									))}
								</ul>
							</Reveal>
						</div>
					</div>
				</section>

				{/* features carousel */}
				<section id="features" className="scroll-mt-20 pt-36 pb-28">
					<div className="flex flex-col items-center px-5 text-center">
						<Headline lines={[<><em>Capture</em> every invoice,</>, "effortlessly."]} />
						<Reveal delay={150}>
							<div className="mt-8">
								<Cta variant="dark">See it in the demo</Cta>
							</div>
						</Reveal>
					</div>
					<div className="mt-16">
						<Reveal>
							<FeatureCarousel cards={FEATURES} />
						</Reveal>
					</div>
				</section>

				{/* always on: dotted grid, pulsing dot, cycling notifications */}
				<section className="relative overflow-hidden px-5 py-36 text-center">
					<div aria-hidden className="home-dots absolute inset-0" />
					<div className="relative flex flex-col items-center">
						<span className="home-pulse size-3 rounded-full bg-[#4ade80]" />
						<div className="mt-12">
							<Headline lines={[<><em>Know</em> before</>, "it's too late."]} />
						</div>
						<Reveal delay={200}>
							<div className="mt-12 w-[min(460px,calc(100vw-40px))]">
								<Notifications />
							</div>
						</Reveal>
					</div>
				</section>

				{/* how it works: scene + screen pairs */}
				<section id="how" className="mx-auto flex max-w-[1400px] scroll-mt-20 flex-col gap-4 px-4 py-20 sm:px-5">
					<Pair
						scene="dune"
						title={["We read", <em key="e">everything</em>]}
						body="Invoices, receipts, purchase orders and contracts become one searchable record."
					>
						<DocMarquee />
					</Pair>
					<Pair
						flip
						scene="meadow"
						title={["We check", <em key="e">every line</em>]}
						body="Totals, duplicates, vendors, dates, PO numbers and hidden instructions, before anything is recorded."
					>
						<ChecksMock />
					</Pair>
					<Pair
						scene="dusk"
						title={["We show", <em key="e">our work</em>]}
						body="Every answer points to the clause or the transactions behind it, so you can check it in a click."
					>
						<AnswerMock />
					</Pair>
				</section>

				{/* human in the loop: full-bleed scene */}
				<section className="px-4 py-20 sm:px-5">
					<div className="relative mx-auto flex min-h-[720px] max-w-[1400px] flex-col items-center justify-center overflow-hidden rounded-[24px] px-6 py-24 text-center">
						<Scene name="bloom" />
						<div className="relative flex flex-col items-center">
							<Reveal>
								<span className="flex items-center gap-3 rounded-full border border-white/25 bg-black/25 px-4 py-2 text-[12px] text-white backdrop-blur">
									<span className={mono}>Lumen</span>
									<ShieldCheck className="size-4" strokeWidth={1.5} />
									<span className={mono}>You</span>
								</span>
							</Reveal>
							<div className="mt-8">
								<Headline lines={["Nothing changes", <em key="e">without you.</em>]} />
							</div>
							<Reveal delay={150}>
								<p className="mx-auto mt-6 max-w-md text-[16px] leading-[1.5] text-white/90">
									Lumen proposes: recategorise, flag, mark as paid. You approve or reject, and every decision is logged.
								</p>
							</Reveal>
							<div className="mt-10 w-full">
								<Reveal delay={250}>
									<div className="flex justify-center">
										<ProposalMock />
									</div>
								</Reveal>
							</div>
						</div>
					</div>
				</section>

				{/* ask lumen: violet light, chat phone */}
				<section id="ask" className="scroll-mt-20 px-4 py-20 sm:px-5">
					<div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[24px] bg-[#070708] pt-28 text-center">
						<div
							aria-hidden
							className="absolute -top-40 -left-40 h-[900px] w-[520px] rotate-12 blur-[60px]"
							style={{ background: "linear-gradient(180deg, #847dff 0%, #4b49aa 45%, #00b3dd 100%)", opacity: 0.55 }}
						/>
						<div
							aria-hidden
							className="absolute -top-40 -right-40 h-[900px] w-[420px] -rotate-12 blur-[70px]"
							style={{ background: "linear-gradient(180deg, #4b49aa 0%, #847dff 60%, transparent 100%)", opacity: 0.35 }}
						/>
						<div className="relative flex flex-col items-center px-6">
							<Sparkles className="size-8 text-[#a49eff]" strokeWidth={1.3} fill="#847dff" />
							<div className="mt-6">
								<Headline lines={["Your numbers,", <em key="e">explained.</em>]} />
							</div>
							<Reveal delay={150}>
								<p className="mx-auto mt-6 max-w-md text-[16px] leading-[1.5] text-[#9f9fa0]">
									Ask Lumen anything about your spending, invoices and contracts, and get answers grounded in your own
									records.
								</p>
							</Reveal>
							<div className="mt-14 -mb-[180px] w-full">
								<Reveal delay={250}>
									<ChatPhone />
								</Reveal>
							</div>
						</div>
					</div>
				</section>

				{/* questions grid */}
				<section className="mx-auto max-w-[1200px] px-5 pt-32 pb-28">
					<div className="text-center">
						<Headline lines={[<>Ask it <em>anything</em>.</>]} />
					</div>
					<div className="mt-16 grid gap-x-12 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
						{QUESTIONS.map(([topic, question], i) => (
							<Reveal key={question} delay={(i % 3) * 120}>
								<span className={`${mono} text-[10.5px] font-medium tracking-[0.14em] text-[#6a6b6b]`}>{topic}</span>
								<p className="mt-3 font-display text-[24px] leading-[1.25] font-light text-[#f5f5f7]">
									&ldquo;{question}&rdquo;
								</p>
							</Reveal>
						))}
					</div>
				</section>

				{/* closing call to action over hills */}
				<section className="relative flex min-h-[640px] items-center justify-center overflow-hidden px-5 text-center">
					<Hills />
					<div className="absolute inset-0 bg-black/15" />
					<div className="relative flex flex-col items-center">
						<Reveal>
							<span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 py-1.5 pr-1.5 pl-4 text-[13px] text-white backdrop-blur">
								Your own private demo
								<span className={`${mono} rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-medium`}>One click</span>
							</span>
						</Reveal>
						<div className="mt-6">
							<Reveal className="home-lines">
								<h2 className="font-display text-[56px] leading-[1] font-light sm:text-[96px]">
									<span className="block overflow-hidden pb-[0.06em]">
										<span className="ln">
											Try <em>Lumen</em>
										</span>
									</span>
								</h2>
							</Reveal>
						</div>
						<Reveal delay={150}>
							<p className="mx-auto mt-5 max-w-md text-[17px] leading-[1.5] text-white/90">
								A year of sample invoices, contracts and purchase orders, ready to explore.
							</p>
							<div className="mt-8">
								<Cta>Get started</Cta>
							</div>
						</Reveal>
					</div>
				</section>
			</main>

			<footer className="px-5 pt-20 pb-10">
				<div className="mx-auto grid max-w-[1200px] gap-12 sm:grid-cols-[2fr_1fr_1fr]">
					<div>
						<Link href="/" className="flex items-center gap-2.5">
							<Image src="/lumen_logo.svg" alt="" width={28} height={28} />
							<span className="text-[17px] text-white">Lumen</span>
						</Link>
						<p className="mt-4 max-w-xs text-[14px] leading-[1.6] text-[#6a6b6b]">
							The AI finance assistant that reads, checks and explains your invoices.
						</p>
					</div>
					<div>
						<p className={`${mono} text-[11px] font-medium text-[#6a6b6b]`}>Product</p>
						<ul className="mt-4 space-y-2.5 text-[14px] text-[#9f9fa0]">
							<li><a href="#features" className="hover:text-white">Features</a></li>
							<li><a href="#how" className="hover:text-white">How it works</a></li>
							<li><a href="#ask" className="hover:text-white">Ask Lumen</a></li>
						</ul>
					</div>
					<div>
						<p className={`${mono} text-[11px] font-medium text-[#6a6b6b]`}>Get started</p>
						<ul className="mt-4 space-y-2.5 text-[14px] text-[#9f9fa0]">
							<li><Link href="/signin" className="hover:text-white">Try the demo</Link></li>
							<li><Link href="/signin" className="hover:text-white">Log in</Link></li>
						</ul>
					</div>
				</div>
				<p className={`${mono} mx-auto mt-16 max-w-[1200px] border-t border-white/[0.06] pt-8 text-[10.5px] text-[#4a4a4c]`}>
					© 2026 Lumen
				</p>
			</footer>
		</div>
	);
}
