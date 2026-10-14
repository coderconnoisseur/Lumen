"use client";

import { useState, type ReactNode } from "react";
import { Pause, Play } from "lucide-react";

export type FeatureCard = { title: string; body: string; mock: ReactNode };

/** The feature cards drift past on their own (a CSS marquee: two copies of the row, the second hidden from assistive
 *  tech), pausing on hover or with the button. Reduced motion: a still row you can scroll sideways. */
export function FeatureCarousel({ cards }: { cards: FeatureCard[] }) {
	const [paused, setPaused] = useState(false);
	return (
		<div>
			<div className="overflow-hidden motion-reduce:overflow-x-auto">
				<div
					className={`home-marquee-x flex w-max hover:[animation-play-state:paused] ${paused ? "[animation-play-state:paused]" : ""}`}
					style={{ animationDuration: `${cards.length * 9}s` }}
				>
					{[...cards, ...cards].map((card, i) => (
						<div key={i} aria-hidden={i >= cards.length || undefined} className="pr-6">
							<article className="flex h-full w-[320px] flex-col rounded-[28px] border border-white/[0.06] bg-[#111112] p-6 sm:w-[500px] sm:p-12">
								<div className="flex min-h-[380px] items-start justify-center">{card.mock}</div>
								<h3 className="mt-8 text-[22px] text-white sm:text-[26px]">{card.title}</h3>
								<p className="mt-3 text-[16px] leading-[1.55] text-[#7d7d80] sm:text-[18px]">{card.body}</p>
							</article>
						</div>
					))}
				</div>
			</div>
			<div className="mt-8 flex justify-center motion-reduce:hidden">
				<button
					type="button"
					aria-label={paused ? "Play the feature cards" : "Pause the feature cards"}
					onClick={() => setPaused((p) => !p)}
					className="flex size-11 items-center justify-center rounded-full bg-white/[0.07] text-white transition-colors duration-200 hover:bg-white/15"
				>
					{paused ? <Play className="size-4" /> : <Pause className="size-4" />}
				</button>
			</div>
		</div>
	);
}
