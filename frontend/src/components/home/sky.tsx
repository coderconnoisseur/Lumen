"use client";

import { useEffect, useRef } from "react";

/** Looping sky video behind the hero (public/home/sky.mp4); a still blue for reduced motion and while it loads. */
export function Sky() {
	const video = useRef<HTMLVideoElement>(null);

	// React doesn't render the `muted` attribute into the HTML, and browsers only autoplay muted video.
	useEffect(() => {
		const el = video.current;
		if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		el.muted = true;
		el.play().catch(() => {});
	}, []);

	return (
		<div aria-hidden className="absolute inset-0 overflow-hidden bg-[linear-gradient(180deg,#1f5fa8,#5596d2)]">
			<video
				ref={video}
				className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
				src="/home/sky.mp4"
				muted
				loop
				playsInline
				preload="auto"
			/>
			<div className="absolute inset-0 bg-[#0b2a52]/15" />
		</div>
	);
}
