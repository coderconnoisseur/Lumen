"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// "Ask anything" (⌘/Ctrl+K, or the sidebar button): one question, handed to Ask Lumen as /ask?q=…, which starts a
// new chat with it (app/(app)/ask/chatbotContent.tsx). No streaming: Ask shows its thinking state, then the answer.
export function AskPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const router = useRouter();
	const [text, setText] = useState("");
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) setText("");
			}}
		>
			<DialogContent className="top-[28%] max-w-xl gap-2 p-3" aria-describedby="ask-palette-hint">
				<DialogTitle className="sr-only">Ask anything</DialogTitle>
				<form
					className="flex items-center gap-3 px-1"
					onSubmit={(e) => {
						e.preventDefault();
						const q = text.trim();
						if (!q) return;
						onOpenChange(false);
						setText("");
						router.push(`/ask?q=${encodeURIComponent(q)}`);
					}}
				>
					<Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
					<input
						autoFocus
						aria-label="Ask Lumen anything"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="Ask anything about your money…"
						maxLength={1000}
						className="h-11 w-full bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
					/>
				</form>
				<DialogDescription id="ask-palette-hint" className="label-ui px-1 text-muted-foreground">
					Enter to ask · Esc to close
				</DialogDescription>
			</DialogContent>
		</Dialog>
	);
}
