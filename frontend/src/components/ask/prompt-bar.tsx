"use client";

// Composer adapted from Beautiful UI's Prompt Bar (beautifului.dev, MIT): auto-growing input, voice, send.
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Mic } from "lucide-react";
import { toast } from "@/lib/toast";

export function PromptBar({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const canSend = draft.trim().length > 0 && !busy;

	useLayoutEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "0px";
		input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
	}, [draft]);

	function send() {
		if (!canSend) return;
		onSend(draft.trim());
		setDraft("");
	}

	return (
		<div className="flex items-end gap-1 rounded-[14px] border border-line bg-surface p-1.5 shadow-card transition-colors duration-150 focus-within:border-line-strong">
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
				placeholder="Ask about your spending, invoices or documents…"
				aria-label="Ask Lumen"
				className="min-h-8 min-w-0 flex-1 resize-none bg-transparent px-2 py-[7px] text-[14px] leading-[18px] text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3"
			/>
			{/* Voice input lands with its backend; the button is here so the bar's layout is final. */}
			<button
				type="button"
				aria-label="Voice input (coming soon)"
				title="Voice input (coming soon)"
				onClick={() => toast.info("Voice input is coming soon.")}
				className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94]"
			>
				<Mic className="size-4" strokeWidth={2} />
			</button>
			<button
				type="button"
				aria-label="Send"
				disabled={!canSend}
				onClick={send}
				className="flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94]"
				style={{
					background: canSend ? "var(--ink)" : "var(--line-strong)",
					color: canSend ? "var(--surface)" : "var(--ink-2)",
				}}
			>
				<ArrowUp className="size-4" strokeWidth={2.4} />
			</button>
		</div>
	);
}
