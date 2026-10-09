"use client";

import { useEffect, useState } from "react";

/** Types each question out, holds it, erases it and moves on: a looping "someone is asking" input. */
export function TypingInput({ questions }: { questions: string[] }) {
	const [index, setIndex] = useState(0);
	const [length, setLength] = useState(0);
	const [erasing, setErasing] = useState(false);
	const text = questions[index];

	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setLength(text.length);
			return;
		}
		const done = length === text.length;
		const delay = erasing ? 22 : done ? 1800 : 55;
		const timer = setTimeout(() => {
			if (!erasing && done) setErasing(true);
			else if (erasing && length === 0) {
				setErasing(false);
				setIndex((i) => (i + 1) % questions.length);
			} else setLength((l) => l + (erasing ? -1 : 1));
		}, delay);
		return () => clearTimeout(timer);
	}, [length, erasing, text, questions.length]);

	return (
		<span>
			{text.slice(0, length)}
			<span className="home-caret ml-px inline-block h-[1.1em] w-px translate-y-[2px] bg-white/80" />
		</span>
	);
}
