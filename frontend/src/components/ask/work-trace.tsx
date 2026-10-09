"use client";

// "How I got this": adapted from Beautiful UI's Thinking trace (beautifului.dev, MIT), fed by the agent's real steps.
import { useEffect, useState } from "react";
import { Check, ChevronDown, Sparkles, X } from "lucide-react";
import type { ChatStep } from "@/lib/api/client";

const TOOL_LABELS: Record<string, string> = {
	get_schema: "Read the data layout",
	lookup_vendors: "Looked up vendors",
	run_sql: "Queried your transactions",
	search_documents: "Searched your documents",
	get_invoice: "Opened an invoice",
	get_anomalies: "Checked for unusual spending",
	forecast: "Forecast spending",
	propose_action: "Filed a proposal",
};

function seconds(ms: number) {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Shimmering "Thinking" header with a live timer, shown while the answer is on its way. */
export function Thinking() {
	const [started] = useState(() => Date.now());
	const [now, setNow] = useState(started);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 100);
		return () => clearInterval(timer);
	}, []);

	return (
		<div role="status" className="flex items-center gap-2 py-1">
			<Sparkles className="size-4 text-ink-2" />
			<span
				className="bg-clip-text text-[13px] font-medium text-transparent"
				style={{
					backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
					backgroundSize: "200% 100%",
					animation: "shimmer-text 1.4s linear infinite",
				}}
			>
				Thinking
			</span>
			<span className="font-mono text-[11.5px] text-ink-3 tabular-nums">{seconds(now - started)}</span>
		</div>
	);
}

/** Collapsible list of the tools the agent ran, with timings and the SQL it executed. */
export function WorkTrace({ steps, sql, elapsedMs }: { steps: ChatStep[]; sql: string[]; elapsedMs?: number }) {
	const [open, setOpen] = useState(false);
	if (steps.length === 0) return null;

	let sqlIndex = 0;
	const rows = steps.map((step) => ({ step, sql: step.tool === "run_sql" ? sql[sqlIndex++] : undefined }));

	return (
		<div className="flex flex-col">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
			>
				<Sparkles className="size-4 text-ink-3" />
				<span className="text-[13px] font-medium text-ink-2">
					Used {steps.length} {steps.length === 1 ? "step" : "steps"}
					{elapsedMs ? ` · ${seconds(elapsedMs)}` : ""}
				</span>
				<ChevronDown
					className="size-3.5 text-ink-3 transition-transform duration-300"
					style={{ transform: open ? "rotate(180deg)" : "none" }}
				/>
			</button>

			<div
				className="grid transition-[grid-template-rows,opacity] duration-300"
				style={{
					gridTemplateRows: open ? "1fr" : "0fr",
					opacity: open ? 1 : 0,
					transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
				}}
			>
				<div className="overflow-hidden">
					<ol className="relative mt-1 ml-[7px] flex flex-col gap-1 border-l border-line py-1 pl-4">
						{rows.map(({ step, sql: query }, i) => {
							const failed = step.summary?.startsWith("error");
							return (
								<li key={i} className="flex flex-col gap-1.5">
									<div className="flex min-h-7 items-center gap-2 text-[12.5px]">
										{failed ? (
											<X className="size-3.5 shrink-0 text-red" strokeWidth={2.5} />
										) : (
											<Check className="size-3.5 shrink-0 text-ink-3" strokeWidth={2.5} />
										)}
										<span className="font-medium text-ink">{TOOL_LABELS[step.tool] ?? step.tool}</span>
										{step.summary && <span className="min-w-0 truncate text-ink-3">{step.summary}</span>}
										{step.latency_ms != null && (
											<span className="ml-auto shrink-0 font-mono text-[11px] text-ink-3 tabular-nums">
												{step.latency_ms} ms
											</span>
										)}
									</div>
									{query && (
										<pre className="overflow-x-auto rounded-card bg-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2 shadow-hairline">
											{query}
										</pre>
									)}
								</li>
							);
						})}
					</ol>
				</div>
			</div>
		</div>
	);
}
