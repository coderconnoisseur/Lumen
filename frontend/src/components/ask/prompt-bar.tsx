"use client";

// Composer adapted from Beautiful UI's Prompt Bar (beautifului.dev, MIT): auto-growing input, voice, send.
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Mic } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function PromptBar({
	onSend,
	busy,
	hero = false,
}: {
	onSend: (text: string) => void;
	busy: boolean;
	/** the large, centred version shown before the first question */
	hero?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const canSend = draft.trim().length > 0 && !busy;

	useLayoutEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "0px";
		input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
	}, [draft]);

	function send() {
		if (!canSend) return;
		onSend(draft.trim());
		setDraft("");
	}

	return (
		<div
			onClick={() => inputRef.current?.focus()}
			className={cn(
				"flex cursor-text flex-col gap-2 rounded-[22px] border border-line bg-canvas p-2.5 transition-colors duration-200 focus-within:border-line-strong",
				hero && "p-3"
			)}
		>
			<textarea
				ref={inputRef}
				rows={1}
				autoFocus
				value={draft}
				maxLength={1000}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
						event.preventDefault();
						send();
					}
				}}
				placeholder={hero ? "Where am I overspending this month?" : "Ask a follow-up…"}
				aria-label="Ask Lumen"
				className={cn(
					"w-full resize-none bg-transparent px-2.5 pt-1 text-[15px] leading-6 text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3",
					hero && "min-h-14"
				)}
			/>
			<div className="flex items-center justify-end gap-1.5">
				{/* Voice input lands with its backend; the button is here so the bar's layout is final. */}
				<button
					type="button"
					aria-label="Voice input (coming soon)"
					title="Voice input (coming soon)"
					onClick={() => toast.info("Voice input is coming soon.")}
					className="flex size-9 items-center justify-center rounded-full text-ink-2 transition-colors duration-200 hover:bg-hover-2 hover:text-ink"
				>
					<Mic className="size-[18px]" strokeWidth={1.8} />
				</button>
				<button
					type="button"
					aria-label="Send"
					disabled={!canSend}
					onClick={send}
					className="flex size-9 items-center justify-center rounded-full transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94]"
					style={{
						background: canSend ? "#ffffff" : "rgb(255 255 255 / 0.12)",
						color: canSend ? "#000000" : "var(--ink-3)",
					}}
				>
					<ArrowUp className="size-[18px]" strokeWidth={2.2} />
				</button>
			</div>
		</div>
	);
}
