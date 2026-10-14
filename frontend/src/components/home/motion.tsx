"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Landing page text effects (2026-10-14 motion pass): motion only where it says something. Every effect shows its
// final state for reduced motion, and screen readers get the plain text (the animated copy is aria-hidden).

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Calls `onShow` once, the first time the element is on screen. */
function useOnScreen<T extends HTMLElement>(onShow: () => void, rootMargin = "0px 0px -10% 0px") {
	const ref = useRef<T>(null);
	const show = useRef(onShow);
	show.current = onShow;
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const io = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					show.current();
					io.disconnect();
				}
			},
			{ rootMargin }
		);
		io.observe(el);
		return () => io.disconnect();
	}, [rootMargin]);
	return ref;
}

/** The hero's italic word cycles through what Lumen does. */
export function RotatingWord({ words, interval = 2200 }: { words: string[]; interval?: number }) {
	const [i, setI] = useState(0);
	useEffect(() => {
		if (reducedMotion()) return;
		const id = setInterval(() => setI((n) => (n + 1) % words.length), interval);
		return () => clearInterval(id);
	}, [words.length, interval]);
	const widest = words.reduce((a, b) => (b.length > a.length ? b : a));
	return (
		<>
			<span className="sr-only">{words[0]}</span>
			<span aria-hidden className="home-rotate">
				{words.map((w, n) => (
					<em key={w} data-state={n === i ? "in" : n === (i - 1 + words.length) % words.length ? "out" : "wait"}>
						{w}
					</em>
				))}
				{/* the widest word holds the width so the line never jumps */}
				<em className="invisible">{widest}</em>
			</span>
		</>
	);
}

/** Digits roll into place like a counter when the number first shows. */
export function RollingNumber({ value, delay = 0 }: { value: string; delay?: number }) {
	const [on, setOn] = useState(false);
	// zero margin: the hero's figure sits near the bottom of the first screen and must still roll on load
	const ref = useOnScreen<HTMLSpanElement>(() => {
		setTimeout(() => setOn(true), reducedMotion() ? 0 : delay);
	}, "0px");
	let digit = 0;
	return (
		<span ref={ref} className="whitespace-nowrap tabular-nums">
			<span className="sr-only">{value}</span>
			<span aria-hidden>
				{[...value].map((ch, n) =>
					/\d/.test(ch) ? (
						<span key={n} className="home-roll">
							<span
								className="home-roll-col"
								style={{
									transform: on ? `translateY(-${Number(ch) * 10}%)` : undefined,
									transitionDelay: `${digit++ * 70}ms`,
								}}
							>
								{"0123456789".split("").map((d) => (
									<span key={d}>{d}</span>
								))}
							</span>
						</span>
					) : (
						<span key={n}>{ch}</span>
					)
				)}
			</span>
		</span>
	);
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&";

/** Mono labels decode from random glyphs once, when they first show. */
export function DecodeText({ text, delay = 0 }: { text: string; delay?: number }) {
	const [shown, setShown] = useState(text);
	const ref = useOnScreen<HTMLSpanElement>(() => {
		if (reducedMotion()) return;
		setTimeout(() => {
			let frame = 0;
			const id = setInterval(() => {
				frame++;
				setShown(
					[...text]
						.map((c, n) => (c === " " || n < frame / 2 ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
						.join("")
				);
				if (frame / 2 >= text.length) clearInterval(id);
			}, 28);
		}, delay);
	});
	return (
		<span ref={ref}>
			<span className="sr-only">{text}</span>
			<span aria-hidden>{shown}</span>
		</span>
	);
}

/** A paragraph that lights up word by word as it scrolls through the view (CSS scroll-driven animation in home.css;
 *  browsers without it show the text normally). */
export function ScrollLitText({ children, className = "" }: { children: string; className?: string }) {
	const words = children.split(" ");
	return (
		<p className={`home-lit ${className}`}>
			{words.map((w, n) => (
				<span key={n} style={{ ["--i" as string]: n, ["--n" as string]: words.length }}>
					{w}{" "}
				</span>
			))}
		</p>
	);
}

/** A photo panel that wipes open from its centre the first time it shows. */
export function Wipe({ children, className = "" }: { children: ReactNode; className?: string }) {
	const [open, setOpen] = useState(false);
	const ref = useOnScreen<HTMLDivElement>(() => setOpen(true), "0px 0px -15% 0px");
	return (
		<div ref={ref} data-open={open || undefined} className={`home-wipe ${className}`}>
			{children}
		</div>
	);
}
