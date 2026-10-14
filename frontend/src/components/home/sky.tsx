"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play } from "lucide-react";

/** Hero sky: a still frame paints instantly (preloaded), the looping video (public/home/sky.mp4, first frame
 *  trimmed so it never starts black) fades in over it once it's actually playing. Reduced motion keeps the still.
 *  Once it plays, a small button can pause it (long-running motion must be stoppable); `controlsClassName` places it. */
export function Sky({ controlsClassName = "right-4 bottom-4" }: { controlsClassName?: string }) {
	const video = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const [paused, setPaused] = useState(false);

	const togglePause = () => {
		const el = video.current;
		if (!el) return;
		if (el.paused) el.play().catch(() => {});
		else el.pause();
	};

	// React doesn't render the `muted` attribute into the HTML, and browsers only autoplay muted video.
	useEffect(() => {
		const el = video.current;
		if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		el.muted = true;
		el.play().catch(() => {});
	}, []);

	return (
		<>
			<div aria-hidden className="absolute inset-0 overflow-hidden bg-[#3d7cc0]">
				<Image src="/home/sky-poster.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
				<video
					ref={video}
					onPlaying={() => setPlaying(true)}
				onPlay={() => setPaused(false)}
				onPause={() => setPaused(true)}
					className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700 motion-reduce:hidden"
					style={{ opacity: playing ? 1 : 0 }}
					src="/home/sky.mp4"
					muted
					loop
					playsInline
					preload="auto"
				/>
				<div className="absolute inset-0 bg-[#0b2a52]/15" />
			</div>
			{playing && (
				<button
					type="button"
					onClick={togglePause}
					aria-label={paused ? "Play background video" : "Pause background video"}
					className={`absolute z-10 flex size-9 items-center justify-center rounded-full border border-white/20 bg-black/20 text-white/80 backdrop-blur transition-colors hover:bg-black/35 hover:text-white ${controlsClassName}`}
				>
					{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
				</button>
			)}
		</>
	);
}
