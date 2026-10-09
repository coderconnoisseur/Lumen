"use client";

// The "Ask Lumen" phone: plays a whole conversation (welcome, typing, thinking, a streamed answer, a follow-up)
// once it scrolls into view, then loops. Showcase only: scripted, no network.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Copy, Menu, Mic, MoreHorizontal, SquarePen, ThumbsDown, ThumbsUp } from "lucide-react";
import { Phone, label } from "./mocks";

type Table = { head: string[]; rows: string[][] };
type Turn = { ask: string; answer: string; table?: Table };
type Message = { role: "user" | "lumen"; text: string; words?: number; done?: boolean; table?: Table };

const SCRIPT: Turn[] = [
	{
		ask: "Can I afford a ₹60,000 trip in December?",
		answer:
			"Yes, if you start this month. After bills and savings you have about ₹14,200 spare each month, so putting aside ₹15,000 a month gets you there by December.",
		table: {
			head: ["", "Today", "With plan"],
			rows: [
				["Trip fund", "₹0", "₹60,000"],
				["Savings rate", "21%", "19%"],
				["Emergency fund", "3.2 mo", "3.2 mo"],
			],
		},
	},
	{
		ask: "OK, remember I'm saving for a car next year.",
		answer: "Done. Saved to your money profile, and I'll plan around the car fund from now on.",
	},
];

const SUGGESTIONS = ["Where did my money go last month?", "Any subscriptions I can cancel?", "How's my budget looking?"];
const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function StatusBar() {
	return (
		<div className="flex items-center justify-between px-7 pt-[18px] text-[13px] font-medium text-white">
			<span>9:41</span>
			<span className="flex items-center gap-1.5">
				<svg width="17" height="11" viewBox="0 0 17 11" fill="white">
					{[0, 1, 2, 3].map((i) => (
						<rect key={i} x={i * 4.5} y={8 - i * 2.5} width="3" height={3 + i * 2.5} rx="0.8" />
					))}
				</svg>
				<svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round">
					<path d="M1.5 4a9 9 0 0 1 12 0M4 6.6a5.4 5.4 0 0 1 7 0" />
					<circle cx="7.5" cy="9.2" r="1" fill="white" stroke="none" />
				</svg>
				<span className="flex h-[11px] w-[22px] items-center rounded-[3px] border border-white/50 p-[1.5px]">
					<span className="h-full w-[70%] rounded-[1.5px] bg-white" />
				</span>
			</span>
		</div>
	);
}

export function ChatDemo() {
	const root = useRef<HTMLDivElement>(null);
	const [started, setStarted] = useState(false);
	const [messages, setMessages] = useState<Message[]>([]);
	const [draft, setDraft] = useState("");
	const [typing, setTyping] = useState(false);
	const [thinking, setThinking] = useState(false);

	useEffect(() => {
		const el = root.current;
		if (!el) return;
		const observer = new IntersectionObserver(([entry]) => {
			if (entry.isIntersecting) {
				setStarted(true);
				observer.disconnect();
			}
		}, { threshold: 0.35 });
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!started) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setMessages(
				SCRIPT.flatMap((t) => [
					{ role: "user" as const, text: t.ask },
					{ role: "lumen" as const, text: t.answer, words: t.answer.split(" ").length, done: true, table: t.table },
				])
			);
			return;
		}
		let alive = true;
		const reveal = (update: (last: Message) => Message) =>
			setMessages((list) => list.map((m, i) => (i === list.length - 1 ? update(m) : m)));

		(async () => {
			while (alive) {
				setMessages([]);
				await sleep(1800);
				for (const turn of SCRIPT) {
					if (!alive) return;
					setTyping(true);
					for (let i = 1; i <= turn.ask.length && alive; i++) {
						setDraft(turn.ask.slice(0, i));
						await sleep(42);
					}
					await sleep(500);
					setTyping(false);
					setDraft("");
					setMessages((list) => [...list, { role: "user", text: turn.ask }]);
					await sleep(450);
					setThinking(true);
					await sleep(1400);
					setThinking(false);
					setMessages((list) => [...list, { role: "lumen", text: turn.answer, words: 0, table: turn.table }]);
					const total = turn.answer.split(" ").length;
					for (let w = 1; w <= total && alive; w++) {
						reveal((m) => ({ ...m, words: w }));
						await sleep(60);
					}
					reveal((m) => ({ ...m, done: true }));
					await sleep(2600);
				}
				await sleep(4000);
			}
		})();
		return () => {
			alive = false;
		};
	}, [started]);

	const empty = messages.length === 0 && !typing;

	return (
		<div ref={root}>
			<Phone>
				<div className="flex h-full flex-col bg-[#0b0b0c] text-left">
					<StatusBar />
					<div className="flex items-center justify-between px-5 pt-5 pb-2 text-[#d4d4d6]">
						<Menu className="size-5" strokeWidth={1.6} />
						<span className="flex items-center gap-4">
							<SquarePen className="size-[18px]" strokeWidth={1.6} />
							<MoreHorizontal className="size-5" strokeWidth={1.6} />
						</span>
					</div>

					<div className="relative min-h-0 flex-1 overflow-hidden px-5">
						{/* welcome screen */}
						<div
							className="absolute inset-x-5 top-[18%] flex flex-col items-center text-center transition-all duration-500"
							style={{ opacity: messages.length ? 0 : 1, transform: messages.length ? "translateY(-12px)" : "none" }}
						>
							<span className="flex size-12 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_30%,#c9c4ff,#847dff_45%,#4b49aa)]" />
							<p className="mt-5 font-display text-[28px] leading-tight font-light text-white">Welcome back, Aarav</p>
							<p className="mt-1 text-[13px] text-[#8a8a8c]">What&apos;s on your mind today?</p>
							<div className={`mt-6 flex w-full flex-col gap-2 transition-opacity duration-300 ${empty ? "opacity-100" : "opacity-0"}`}>
								{SUGGESTIONS.map((s) => (
									<span key={s} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5 text-left text-[12.5px] text-[#d4d4d6]">
										{s}
									</span>
								))}
							</div>
						</div>

						{/* conversation, newest at the bottom */}
						<div className="flex h-full flex-col justify-end gap-4 pb-3">
							{messages.map((m, i) =>
								m.role === "user" ? (
									<div key={i} className="flex justify-end pl-10" style={{ animation: "fade-up 300ms ease both" }}>
										<span className="rounded-[18px] bg-[#2a2a2c] px-3.5 py-2 text-[13.5px] leading-snug text-white">{m.text}</span>
									</div>
								) : (
									<div key={i} className="text-[13.5px] leading-[1.55] text-white">
										<p>{m.text.split(" ").slice(0, m.words).join(" ")}</p>
										{m.table && (
											<div
												className="mt-2.5 overflow-hidden rounded-[12px] border border-white/[0.08] text-[12px] transition-opacity duration-500"
												style={{ opacity: m.done ? 1 : 0 }}
											>
												<div className="grid grid-cols-[1.3fr_1fr_1fr] bg-white/[0.04] px-3 py-1.5 text-[#8a8a8c]">
													{m.table.head.map((h) => (
														<span key={h}>{h}</span>
													))}
												</div>
												{m.table.rows.map((row) => (
													<div key={row[0]} className="grid grid-cols-[1.3fr_1fr_1fr] border-t border-white/[0.06] px-3 py-2">
														{row.map((cell, j) => (
															<span key={j} className={j === 0 ? "text-[#b4b4b6]" : "text-white"}>
																{cell}
															</span>
														))}
													</div>
												))}
											</div>
										)}
										<div
											className="mt-2.5 flex gap-3.5 text-[#6a6b6b] transition-opacity duration-500"
											style={{ opacity: m.done ? 1 : 0 }}
										>
											<ThumbsUp className="size-[15px]" strokeWidth={1.6} />
											<ThumbsDown className="size-[15px]" strokeWidth={1.6} />
											<Copy className="size-[15px]" strokeWidth={1.6} />
										</div>
									</div>
								)
							)}
							{thinking && (
								<span
									className="bg-clip-text text-[13px] text-transparent"
									style={{
										backgroundImage: "linear-gradient(90deg, #6a6b6b 35%, #f5f5f7 50%, #6a6b6b 65%)",
										backgroundSize: "200% 100%",
										animation: "shimmer-text 1.4s linear infinite",
									}}
								>
									Thinking…
								</span>
							)}
						</div>
					</div>

					{/* chat bar */}
					<div className="px-3 pb-3">
						<div className="rounded-[22px] border border-white/10 bg-[#161617] p-3">
							<p className="min-h-[38px] px-1 text-[13.5px] leading-snug text-white">
								{draft || <span className="text-[#6a6b6b]">Ask anything</span>}
								{typing && <span className="home-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-white" />}
							</p>
							<div className="mt-1 flex items-center justify-between">
								<span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-[#9f9fa0]">
									<span className="size-1.5 rounded-full bg-[#4ade80]" /> 3 accounts connected
								</span>
								<span className="flex items-center gap-2">
									<Mic className="size-4 text-[#9f9fa0]" strokeWidth={1.6} />
									<span
										className={`flex size-7 items-center justify-center rounded-full transition-colors duration-200 ${
											draft ? "bg-white text-black" : "bg-white/10 text-[#6a6b6b]"
										}`}
									>
										<ArrowUp className="size-4" strokeWidth={2.2} />
									</span>
								</span>
							</div>
						</div>
						<p className="mt-2 text-center text-[10px] text-[#5a5a5c]">Lumen can make mistakes. Check the sources.</p>
					</div>

					{/* keyboard slides up while typing */}
					<div
						className="overflow-hidden bg-[#1f1f22] transition-[height] duration-300 ease-out"
						style={{ height: typing ? 196 : 0 }}
					>
						<div className="flex flex-col gap-2.5 px-1 pt-2.5">
							{KEYS.map((row, r) => (
								<div key={row} className="flex justify-center gap-[5px]">
									{r === 2 && <span className="flex h-[38px] w-[38px] items-center justify-center rounded-md bg-[#3d3d40] text-[13px] text-white">⇧</span>}
									{row.split("").map((k) => (
										<span key={k} className="flex h-[38px] w-[27px] items-center justify-center rounded-md bg-[#5c5c60] text-[15px] text-white">
											{k}
										</span>
									))}
									{r === 2 && <span className="flex h-[38px] w-[38px] items-center justify-center rounded-md bg-[#3d3d40] text-[13px] text-white">⌫</span>}
								</div>
							))}
							<div className="flex gap-[5px] px-1">
								<span className="flex h-[38px] w-[64px] items-center justify-center rounded-md bg-[#3d3d40] text-[13px] text-white">123</span>
								<span className="flex h-[38px] flex-1 items-center justify-center rounded-md bg-[#5c5c60] text-[13px] text-white">space</span>
								<span className="flex h-[38px] w-[72px] items-center justify-center rounded-md bg-[#3d3d40] text-[13px] text-white">return</span>
							</div>
						</div>
					</div>
				</div>
			</Phone>
			<span className={`${label} sr-only`}>Animated example conversation with Lumen</span>
		</div>
	);
}
