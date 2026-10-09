"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

/** Hero sky: a still frame paints instantly (preloaded), the looping video (public/home/sky.mp4, first frame
 *  trimmed so it never starts black) fades in over it once it's actually playing. Reduced motion keeps the still. */
export function Sky() {
	const video = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);

	// React doesn't render the `muted` attribute into the HTML, and browsers only autoplay muted video.
	useEffect(() => {
		const el = video.current;
		if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		el.muted = true;
		el.play().catch(() => {});
	}, []);

	return (
		<div aria-hidden className="absolute inset-0 overflow-hidden bg-[#3d7cc0]">
			<Image src="/home/sky-poster.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
			<video
				ref={video}
				onPlaying={() => setPlaying(true)}
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
	);
}
