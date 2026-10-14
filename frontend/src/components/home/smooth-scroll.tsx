"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/** Inertial smooth scrolling for the landing page only (Lenis). Nav links glide to their section; the sections'
 *  scroll-margin (scroll-mt-20) clears the fixed nav. Off for reduced motion, so the page scrolls natively. */
export function SmoothScroll() {
	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const lenis = new Lenis({ autoRaf: true, anchors: true });
		return () => lenis.destroy();
	}, []);
	return null;
}
