"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

function advance(el: HTMLDivElement | null, direction: 1 | -1) {
	if (!el) return;
	const card = el.firstElementChild as HTMLElement | null;
	const stride = (card?.offsetWidth ?? 320) + 16;
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
				className="home-noscroll flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:px-[max(20px,calc((100vw-1200px)/2))]"
			>
				{cards.map((card) => (
					<article
						key={card.title}
						className="flex w-[300px] shrink-0 snap-start flex-col rounded-[24px] border border-white/[0.06] bg-[#111112] p-6 sm:w-[400px]"
					>
						<div className="flex h-[300px] items-center justify-center">{card.mock}</div>
						<h3 className="mt-6 text-[20px] text-white">{card.title}</h3>
						<p className="mt-2 text-[15px] leading-[1.5] text-[#8a8a8c]">{card.body}</p>
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
