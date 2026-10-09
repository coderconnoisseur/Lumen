"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

function advance(el: HTMLDivElement | null, direction: 1 | -1) {
	if (!el) return;
	const card = el.firstElementChild as HTMLElement | null;
	const stride = (card?.offsetWidth ?? 320) + 24;
	const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
	if (direction === 1 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
	else el.scrollBy({ left: direction * stride, behavior: "smooth" });
}

export type FeatureCard = { title: string; body: string; mock: ReactNode };

/** Auto-advancing, swipeable row of feature cards with previous / pause / next controls. */
export function FeatureCarousel({ cards }: { cards: FeatureCard[] }) {
	const track = useRef<HTMLDivElement>(null);
	const [playing, setPlaying] = useState(true);
	const [hovered, setHovered] = useState(false);

	useEffect(() => {
		if (!playing || hovered) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const timer = setInterval(() => advance(track.current, 1), 3500);
		return () => clearInterval(timer);
	}, [playing, hovered]);

	const control =
		"flex size-11 items-center justify-center rounded-full bg-white/[0.07] text-white transition-colors duration-200 hover:bg-white/15";

	return (
		<div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
			<div
				ref={track}
				className="home-noscroll flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth px-5 pb-2 sm:px-[max(20px,calc((100vw-1200px)/2))]"
			>
				{cards.map((card) => (
					<article
						key={card.title}
						className="flex w-[320px] shrink-0 snap-start flex-col rounded-[28px] border border-white/[0.06] bg-[#111112] p-6 sm:w-[500px] sm:p-12"
					>
						<div className="flex min-h-[380px] items-start justify-center">{card.mock}</div>
						<h3 className="mt-8 text-[22px] text-white sm:text-[26px]">{card.title}</h3>
						<p className="mt-3 text-[16px] leading-[1.55] text-[#7d7d80] sm:text-[18px]">{card.body}</p>
					</article>
				))}
			</div>
			<div className="mt-8 flex justify-center gap-3">
				<button type="button" aria-label="Previous" onClick={() => advance(track.current, -1)} className={control}>
					<ChevronLeft className="size-4" />
				</button>
				<button
					type="button"
					aria-label={playing ? "Pause" : "Play"}
					onClick={() => setPlaying((p) => !p)}
					className={control}
				>
					{playing ? <Pause className="size-4" /> : <Play className="size-4" />}
				</button>
				<button type="button" aria-label="Next" onClick={() => advance(track.current, 1)} className={control}>
					<ChevronRight className="size-4" />
				</button>
			</div>
		</div>
	);
}
