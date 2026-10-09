"use client";

// Ask Lumen: one chat with the agent. Every answer shows its sources, the steps behind it, and any change it proposes.
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Answer } from "@/components/ask/answer";
import { Button } from "@/components/ask/button";
import { PromptBar } from "@/components/ask/prompt-bar";
import { ProposalCard } from "@/components/ask/proposal-card";
import { Thinking, WorkTrace } from "@/components/ask/work-trace";
import { DashboardShell } from "@/components/dashboard-shell";
import { agentApi, chatApi, type ChatAnswer, type Proposal } from "@/lib/api/client";
import { toast } from "@/lib/toast";

type Message = {
	id: string;
	role: "user" | "assistant";
	content: string;
	/** the question an assistant message answers, for "ask again" */
	question?: string;
	/** evidence; only live answers have it (history stores the text) */
	answer?: ChatAnswer;
	elapsedMs?: number;
	pending?: boolean;
	error?: boolean;
};

// Tools whose results are the user's own data; an answer built on them has evidence even without a cited passage.
const DATA_TOOLS = new Set(["run_sql", "get_invoice", "get_anomalies", "forecast", "lookup_vendors"]);

function greeting() {
	const hour = new Date().getHours();
	return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function errorMessage(error: unknown): string {
	return (
		(error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
		"Lumen couldn't answer right now. Please try again."
	);
}

export default function ChatbotContent() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [proposals, setProposals] = useState<Proposal[]>([]);
	const [loaded, setLoaded] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const busy = messages.some((m) => m.pending);

	useEffect(() => {
		Promise.allSettled([chatApi.getHistory(), chatApi.getSuggestions(), agentApi.proposals()]).then(
			([history, suggested, pending]) => {
				if (history.status === "fulfilled" && history.value.success) {
					setMessages(
						(history.value.messages as { id: string; role: Message["role"]; content: string }[]).map((m) => ({
							id: m.id,
							role: m.role,
							content: m.content,
						}))
					);
				}
				if (suggested.status === "fulfilled") setSuggestions(suggested.value.suggestions ?? []);
				if (pending.status === "fulfilled") setProposals(pending.value);
				setLoaded(true);
			}
		);
	}, []);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [messages]);

	async function ask(question: string, replaceId?: string) {
		const id = crypto.randomUUID();
		const started = Date.now();
		setMessages((list) => [
			...list.filter((m) => m.id !== replaceId),
			...(replaceId ? [] : [{ id: `${id}-q`, role: "user" as const, content: question }]),
			{ id, role: "assistant", content: "", question, pending: true },
		]);
		try {
			const answer = await chatApi.sendMessage(question);
			if (answer.proposals.length) setProposals(await agentApi.proposals());
			setMessages((list) =>
				list.map((m) =>
					m.id === id
						? { ...m, content: answer.response, answer, elapsedMs: Date.now() - started, pending: false }
						: m
				)
			);
		} catch (error) {
			setMessages((list) =>
				list.map((m) => (m.id === id ? { ...m, content: errorMessage(error), pending: false, error: true } : m))
			);
		}
	}

	async function newChat() {
		try {
			await chatApi.clearHistory();
			setMessages([]);
		} catch {
			toast.error("Couldn't clear the conversation.");
		}
	}

	// Proposals filed by answers on screen show under that answer; older pending ones gather at the end.
	const shown = new Set(messages.flatMap((m) => m.answer?.proposals ?? []));
	const waiting = proposals.filter((p) => !shown.has(p.id));

	const proposalCards = (list: Proposal[]) => list.map((p) => <ProposalCard key={p.id} proposal={p} />);
	const waitingBlock = waiting.length > 0 && (
		<div className="flex w-full flex-col gap-2">
			<span className="bui-label text-ink-3">Waiting for your decision</span>
			{proposalCards(waiting)}
		</div>
	);

	return (
		<DashboardShell contentClassName="p-0 sm:p-0 lg:p-0 gap-0">
			<div className="bui relative flex h-[calc(100dvh-3.5rem)] flex-col">
				{messages.length > 0 && (
					<Button
						variant="quiet"
						size="xs"
						onClick={() => void newChat()}
						disabled={busy}
						className="absolute top-3 right-4 z-10"
					>
						<Plus className="size-3.5" /> New chat
					</Button>
				)}

				{loaded && messages.length === 0 ? (
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[8vh]">
						<div className="flex w-full max-w-2xl flex-col items-center" style={{ animation: "fade-up 600ms both" }}>
							<span className="bui-label text-ink-3">Ask Lumen</span>
							<h1 className="mt-5 text-center font-display text-[40px] leading-[1.05] font-light text-ink sm:text-[52px]">
								{greeting()}.
								<br />
								What shall we <em>look into</em>?
							</h1>
							<p className="mt-4 max-w-md text-center text-[16px] leading-relaxed font-light text-ink-2">
								Ask about spending, invoices or contracts. Answers come with their sources.
							</p>
							<div className="mt-8 w-full">
								<PromptBar hero onSend={(text) => void ask(text)} busy={busy} />
							</div>
							<div className="mt-4 flex flex-wrap justify-center gap-2">
								{suggestions.map((text, i) => (
									<button
										key={text}
										type="button"
										onClick={() => void ask(text)}
										className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-ink-2 transition-colors duration-200 hover:border-line-strong hover:bg-hover hover:text-ink"
										style={{ animation: `fade-up 400ms ease ${200 + i * 60}ms both` }}
									>
										{text}
									</button>
								))}
							</div>
							{waitingBlock && <div className="mt-10 w-full">{waitingBlock}</div>}
						</div>
					</div>
				) : (
					<>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="mx-auto flex w-full max-w-3xl flex-col gap-9 px-4 pt-14 pb-8">
								{messages.map((m) =>
									m.role === "user" ? (
										<div key={m.id} className="flex justify-end pl-14">
											<div
												className="rounded-[18px] bg-field px-4 py-2.5 text-[15px] leading-[1.5] whitespace-pre-wrap text-ink"
												style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
											>
												{m.content}
											</div>
										</div>
									) : m.pending ? (
										<Thinking key={m.id} />
									) : m.error ? (
										<div key={m.id} className="flex items-center gap-3 rounded-2xl bg-red-tint px-4 py-3 text-[14px] text-ink">
											<span className="flex-1">{m.content}</span>
											{m.question && (
												<Button variant="secondary" size="xs" onClick={() => void ask(m.question!, m.id)}>
													Try again
												</Button>
											)}
										</div>
									) : (
										<div key={m.id} className="flex flex-col gap-2.5">
											{m.answer && <WorkTrace steps={m.answer.steps} elapsedMs={m.elapsedMs} />}
											<Answer
												content={m.content}
												sources={m.answer?.sources}
												showEvidenceNote={
													!!m.answer && !m.answer.sources.length && !m.answer.steps.some((s) => DATA_TOOLS.has(s.tool))
												}
												onRetry={m.question && !busy ? () => void ask(m.question!, m.id) : undefined}
											>
												{proposalCards(proposals.filter((p) => m.answer?.proposals.includes(p.id)))}
											</Answer>
										</div>
									)
								)}
								{waitingBlock}
								<div ref={bottomRef} />
							</div>
						</div>

						<div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
							<PromptBar onSend={(text) => void ask(text)} busy={busy} />
							<p className="mt-2 text-center text-[11.5px] text-ink-3">
								Lumen cites its sources and only proposes changes; nothing is applied until you approve it.
							</p>
						</div>
					</>
				)}
			</div>
		</DashboardShell>
	);
}
