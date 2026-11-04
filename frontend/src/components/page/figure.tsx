"use client";

import { useEffect, useState } from "react";
import { animate } from "motion/react";

// A hero total. Counts up once per browser session, then shows the number straight away (motion rule: no replay on
// revisits). A Night build swaps this file for figure.night.tsx at bundle time (see next.config.js).
export function Figure({ value, format }: { value: number; format: (n: number) => string }) {
	const [shown, setShown] = useState(value);
	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let seen = false;
		try {
			seen = sessionStorage.getItem("home-countup") === "1";
			sessionStorage.setItem("home-countup", "1");
		} catch {}
		if (reduce || seen || value <= 0) return setShown(value);
		const c = animate(0, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v)) });
		return () => c.stop();
	}, [value]);
	return <>{format(shown)}</>;
}

// A headline amount on the other pages: plain text here, rolling digits in Night.
export function Amount({ value, format }: { value: number; format: (n: number) => string }) {
	return <>{format(value)}</>;
}
