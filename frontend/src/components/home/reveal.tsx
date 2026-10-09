"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** Marks itself [data-shown] the first time it scrolls into view; home.css does the animating. */
export function Reveal({
	children,
	className = "home-reveal",
	delay = 0,
}: {
	children: ReactNode;
	className?: string;
	delay?: number;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					el.setAttribute("data-shown", "");
					observer.disconnect();
				}
			},
			{ rootMargin: "0px 0px -12% 0px" }
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const style: CSSProperties | undefined = delay ? { transitionDelay: `${delay}ms` } : undefined;
	return (
		<div ref={ref} className={className} style={style}>
			{children}
		</div>
	);
}
