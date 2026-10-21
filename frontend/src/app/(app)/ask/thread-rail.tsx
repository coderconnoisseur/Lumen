"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ChatThread } from "@/lib/api/client";
import { relativeTime } from "@/lib/home-math";
import { cn } from "@/lib/utils";

// Past conversations (UI revamp Phase 4): one click resumes, delete asks once inline. Rendered as a column on
// large screens and inside a Sheet below that (chatbotContent.tsx).
export function ThreadRail({
	threads,
	activeId,
	onSelect,
	onNew,
	onDelete,
	disabled,
}: {
	threads: ChatThread[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
	onDelete: (id: string) => void;
	disabled?: boolean;
}) {
	const [confirming, setConfirming] = useState<string | null>(null);
	const now = new Date();
	return (
		<nav aria-label="Past chats" data-testid="thread-rail" className="flex h-full min-h-0 flex-col gap-2 p-3">
			<button
				type="button"
				onClick={onNew}
				disabled={disabled}
				className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
			>
				<Plus className="size-4" /> New chat
			</button>
			<div className="label-mono px-1 pt-2 text-muted-foreground">Recent</div>
			<ul className="min-h-0 flex-1 overflow-y-auto">
				{threads.length === 0 && <li className="px-2 py-1.5 text-[13px] text-muted-foreground">No past chats yet.</li>}
				{threads.map((t) => (
					<li key={t.id} className="group relative">
						{confirming === t.id ? (
							<div className="flex items-center gap-1.5 rounded-lg bg-accent px-2 py-1.5 text-[13px]">
								<span className="min-w-0 flex-1 truncate">Delete this chat?</span>
								<button type="button" className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-background" onClick={() => setConfirming(null)}>
									Keep
								</button>
								<button
									type="button"
									aria-label="Confirm delete"
									className="rounded bg-bad px-1.5 py-0.5 text-white"
									onClick={() => {
										setConfirming(null);
										onDelete(t.id);
									}}
								>
									Delete
								</button>
							</div>
						) : (
							<>
								<button
									type="button"
									aria-current={t.id === activeId ? "page" : undefined}
									disabled={disabled}
									onClick={() => onSelect(t.id)}
									className={cn(
										"flex w-full flex-col rounded-lg px-2 py-1.5 pr-8 text-left transition-colors hover:bg-accent disabled:opacity-60",
										t.id === activeId && "bg-accent",
									)}
								>
									<span className="truncate text-[13px] text-foreground">{t.title}</span>
									<span className="text-[11px] text-muted-foreground">{t.updated_at ? relativeTime(t.updated_at, now) : ""}</span>
								</button>
								<button
									type="button"
									aria-label={`Delete chat: ${t.title}`}
									onClick={() => setConfirming(t.id)}
									className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-background hover:text-foreground"
								>
									<Trash2 className="size-3.5" />
								</button>
							</>
						)}
					</li>
				))}
			</ul>
		</nav>
	);
}
