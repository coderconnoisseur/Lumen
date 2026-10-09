"use client";

// An Ask Lumen answer: markdown with inline citation chips, an action row and the cited passages.
// Visuals adapted from Beautiful UI's Streaming Text and Context Cards (beautifului.dev, MIT).
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, Check, Copy, FileText, Info, RotateCcw } from "lucide-react";
import { filesApi, type ChatSource } from "@/lib/api/client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Same shape the agent cites with (backend agent/graph.py _CITATION).
const CITATION = /[[【]\s*([^[\]【】\s]+#s\d{2}(?:-\d+)?)\s*[\]】]/g;
const CITE_PREFIX = "#cite-";

function openOriginal(key: string) {
	filesApi.open(key).catch(() => toast.error("Couldn't open the original document."));
}

function CitationChip({ number, source, onClick }: { number: number; source?: ChatSource; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={!source}
			title={source ? `${source.title} · ${source.section}` : "Source details aren't kept for older answers"}
			className="mx-0.5 inline-flex h-[18px] max-w-56 translate-y-[-1px] items-center gap-1 rounded-[5px] bg-inset px-1 align-middle font-mono text-[10.5px] text-ink-2 shadow-hairline transition-colors duration-150 hover:bg-hover hover:text-ink disabled:cursor-default"
			style={{ animation: "pop-in 250ms cubic-bezier(0.23,1,0.32,1) both" }}
		>
			<span className="flex size-3 shrink-0 items-center justify-center rounded-[3px] bg-accent-tint text-[8px] font-bold text-accent-ink">
				{number}
			</span>
			{source && <span className="truncate font-sans">{source.title}</span>}
		</button>
	);
}

function SourceCard({ source, number, active }: { source: ChatSource; number: number; active: boolean }) {
	return (
		<div
			id={`source-${source.chunk_id}`}
			className={cn(
				"overflow-hidden rounded-card bg-surface shadow-card transition-shadow duration-300",
				active && "ring-1 ring-accent"
			)}
		>
			<div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
				<span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-accent-tint text-[9px] font-bold text-accent-ink">
					{number}
				</span>
				<span className="min-w-0 truncate text-[13px] font-medium text-ink">{source.title}</span>
				<span className="hidden shrink-0 text-[12px] text-ink-3 sm:inline">{source.section}</span>
				<button
					type="button"
					onClick={() => openOriginal(source.file_key)}
					className="ml-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-inset px-2 text-[12px] font-medium text-ink-2 shadow-btn transition-colors duration-150 hover:bg-hover hover:text-ink"
				>
					<FileText className="size-3" />
					Open original
					<ArrowUpRight className="size-3" />
				</button>
			</div>
			<p className="px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">{source.text}</p>
		</div>
	);
}

export function Answer({
	content,
	sources,
	showEvidenceNote,
	onRetry,
	children,
}: {
	content: string;
	/** undefined for answers loaded from history (their evidence isn't stored) */
	sources?: ChatSource[];
	/** true when the answer cites no passage and looked at none of the user's data */
	showEvidenceNote: boolean;
	onRetry?: () => void;
	children?: ReactNode;
}) {
	const [sourcesOpen, setSourcesOpen] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const byId = new Map((sources ?? []).map((s, i) => [s.chunk_id, { source: s, number: i + 1 }]));
	const order: string[] = [];
	const markdown = content.replace(CITATION, (_, id: string) => {
		if (!order.includes(id)) order.push(id);
		return `[${id}](${CITE_PREFIX}${encodeURIComponent(id)})`;
	});

	function showSource(id: string) {
		setSourcesOpen(true);
		setActiveId(id);
		setTimeout(() => document.getElementById(`source-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 320);
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(content.replace(CITATION, ""));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Couldn't copy the answer.");
		}
	}

	return (
		<div className="flex flex-col gap-2" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
			<div className="bui-md">
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						a: ({ href, children: label }) => {
							if (href?.startsWith(CITE_PREFIX)) {
								const id = decodeURIComponent(href.slice(CITE_PREFIX.length));
								const hit = byId.get(id);
								return (
									<CitationChip
										number={hit?.number ?? order.indexOf(id) + 1}
										source={hit?.source}
										onClick={() => showSource(id)}
									/>
								);
							}
							return (
								<a href={href} target="_blank" rel="noreferrer">
									{label}
								</a>
							);
						},
					}}
				>
					{markdown}
				</ReactMarkdown>
			</div>

			{showEvidenceNote && (
				<p className="flex items-center gap-1.5 text-[12px] text-ink-3">
					<Info className="size-3.5" />
					This answer doesn&apos;t cite a document or your data.
				</p>
			)}

			{children}

			<div className="flex items-center gap-0.5">
				<button
					type="button"
					aria-label="Copy answer"
					onClick={() => void copy()}
					className="flex size-7 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2"
				>
					{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
				</button>
				{onRetry && (
					<button
						type="button"
						aria-label="Ask again"
						onClick={onRetry}
						className="flex size-7 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2"
					>
						<RotateCcw className="size-3.5" />
					</button>
				)}
				{sources && sources.length > 0 && (
					<button
						type="button"
						aria-expanded={sourcesOpen}
						onClick={() => setSourcesOpen((current) => !current)}
						className="ml-1.5 flex items-center gap-1.5 rounded-[6px] px-1.5 py-1 transition-colors duration-150 hover:bg-hover"
					>
						<span className="flex -space-x-1">
							{sources.slice(0, 4).map((s, i) => (
								<span
									key={s.chunk_id}
									className="flex size-3.5 items-center justify-center rounded-full bg-accent-tint text-[8px] font-bold text-accent-ink shadow-[0_0_0_1.5px_var(--page)]"
								>
									{i + 1}
								</span>
							))}
						</span>
						<span className="text-[12px] text-ink-2">
							{sources.length} {sources.length === 1 ? "source" : "sources"}
						</span>
					</button>
				)}
			</div>

			{sources && sources.length > 0 && (
				<div
					className="grid transition-[grid-template-rows,opacity] duration-300"
					style={{
						gridTemplateRows: sourcesOpen ? "1fr" : "0fr",
						opacity: sourcesOpen ? 1 : 0,
						transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
					}}
				>
					<div className="overflow-hidden">
						<div className="flex flex-col gap-2 p-px pt-1">
							{sources.map((s, i) => (
								<SourceCard key={s.chunk_id} source={s} number={i + 1} active={activeId === s.chunk_id} />
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
