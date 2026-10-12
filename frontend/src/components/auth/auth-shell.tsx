"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { FileCheck2, Lock, Quote, UserCheck, type LucideIcon } from "lucide-react";
import "@/app/home.css";
import { NOTIFICATIONS } from "@/components/home/mocks";
import { Sky } from "@/components/home/sky";

// Shell of the sign-in pages (/signin, /reset-password, /demo), so leaving the landing page feels like one site:
// the hero's sky on the left with a serif headline and cycling notifications, the near-black form panel on the right.
// On phones the sky shrinks to a band above the form.

export const mono = "font-[family-name:var(--font-roboto-mono)] uppercase tracking-[0.06em]";

export const authLabel = `${mono} block text-[10.5px] font-medium text-[#9f9fa0]`;
export const authInput =
	"h-11 w-full rounded-lg border border-white/[0.08] bg-[#111113] px-3.5 text-[15px] text-white placeholder:text-[#4a4a4c] transition-colors outline-none hover:border-white/15 focus:border-white/30 focus:ring-2 focus:ring-white/10";
export const authPrimary = `${mono} inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-white text-[12px] font-medium text-black transition-opacity hover:opacity-85 disabled:opacity-60`;
export const authSecondary =
	"inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-[#1c1c1e] text-[14.5px] text-white ring-1 ring-white/10 transition-colors hover:bg-[#252527] disabled:opacity-60";
export const authLink = "text-white underline-offset-4 hover:underline";

/** Style for an `.auth-rise` row that rises in after `step` earlier rows. */
export function rise(step: number): CSSProperties {
	return { animationDelay: `${120 + step * 60}ms` };
}

export function AuthAlert({ tone, children }: { tone: "error" | "notice"; children: ReactNode }) {
	return (
		<div
			role={tone === "error" ? "alert" : "status"}
			className={`auth-rise rounded-lg border px-3.5 py-3 text-[14px] leading-[1.45] ${
				tone === "error"
					? "border-red-400/25 bg-red-500/[0.08] text-red-100"
					: "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-100"
			}`}
		>
			{children}
		</div>
	);
}

const PROMISES: [LucideIcon, string][] = [
	[Quote, "Cites every source"],
	[UserCheck, "You approve every change"],
	[Lock, "Private to your account"],
	[FileCheck2, "Reads your bills"],
];

/** `headline` lines rise into place again whenever `headlineKey` changes (e.g. log in -> sign up). */
export function AuthShell({ headline, headlineKey, children }: {
	headline: ReactNode[];
	headlineKey?: string;
	children: ReactNode;
}) {
	return (
		<div className="min-h-screen bg-[#050505] font-[family-name:var(--font-ui)] text-white antialiased lg:grid lg:grid-cols-[1.1fr_1fr]">
			<aside className="p-3 lg:sticky lg:top-0 lg:h-screen">
				<div className="relative flex h-[240px] flex-col justify-between overflow-hidden rounded-[20px] p-6 sm:h-[280px] lg:h-full lg:rounded-[24px] lg:p-10">
					<Sky />
					<Link href="/" aria-label="Lumen home" className="relative flex w-fit items-center gap-2.5">
						<Image src="/lumen_logo.svg" alt="" width={28} height={28} priority />
						<span className="text-[18px] tracking-tight">Lumen</span>
					</Link>

					<div className="relative">
						<p
							key={headlineKey}
							className="home-intro-lines font-display text-[40px] leading-[1.04] font-light tracking-[-0.01em] sm:text-[52px] lg:text-[68px]"
						>
							{headline.map((line, i) => (
								<span key={i} className="block overflow-hidden pb-[0.06em]">
									<span className="ln" style={{ animationDelay: `${i * 120}ms` }}>
										{line}
									</span>
								</span>
							))}
						</p>

						{/* the landing page's notifications, one at a time, in hero glass */}
						<div aria-hidden className="home-intro mt-10 hidden max-w-[460px] lg:block" style={{ animationDelay: "300ms" }}>
							<div className="home-cycle relative h-[92px]">
								{NOTIFICATIONS.map(([Icon, text, when]) => (
									<div
										key={text}
										className="absolute inset-0 flex items-center gap-4 rounded-[22px] border border-white/25 bg-white/15 px-5 backdrop-blur-xl"
									>
										<Icon className="size-6 shrink-0" strokeWidth={1.4} />
										<span className="flex-1 text-[15px] leading-snug">{text}</span>
										<span className="shrink-0 self-start pt-4 text-[12px] text-white/70">{when}</span>
									</div>
								))}
							</div>
						</div>
					</div>

					<ul className="relative hidden flex-wrap gap-x-8 gap-y-3 lg:flex">
						{PROMISES.map(([Icon, text]) => (
							<li key={text} className="flex items-center gap-2">
								<Icon className="size-4" strokeWidth={1.5} />
								<span className={`${mono} text-[10px] font-medium tracking-[0.12em] text-white/90`}>{text}</span>
							</li>
						))}
					</ul>
				</div>
			</aside>

			<main className="flex items-center justify-center px-5 pt-10 pb-16 lg:py-16">
				<div className="w-full max-w-[380px]">{children}</div>
			</main>
		</div>
	);
}

/** Quiet waiting state for the form panel. */
export function AuthWaiting({ children }: { children: ReactNode }) {
	return (
		<div role="status" className="auth-rise flex items-center gap-3 text-[15px] text-[#9f9fa0]">
			<span className="size-4 animate-spin rounded-full border-2 border-white/15 border-t-white" />
			{children}
		</div>
	);
}
