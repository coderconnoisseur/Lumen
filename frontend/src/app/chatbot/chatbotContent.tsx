"use client";

// Ask Lumen: one chat with the agent. Every answer shows its sources, the steps behind it, and any change it proposes.
import { useEffect, useRef, useState } from "react";
import { CornerDownRight, Plus, Sparkles } from "lucide-react";
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

	return (
		<DashboardShell contentClassName="p-0 sm:p-0 lg:p-0 gap-0">
			<div className="bui flex h-[calc(100dvh-3.5rem)] flex-col">
				<div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
					<span className="text-[13px] font-medium text-ink">Ask Lumen</span>
					{messages.length > 0 && (
						<Button variant="quiet" size="xs" onClick={() => void newChat()} disabled={busy}>
							<Plus className="size-3.5" /> New chat
						</Button>
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
						{loaded && messages.length === 0 && (
							<div className="mt-[8vh] flex flex-col items-center text-center" style={{ animation: "fade-up 400ms both" }}>
								<Sparkles className="size-6 text-accent-ink" />
								<h1 className="mt-3 text-xl font-semibold text-ink">What would you like to know?</h1>
								<p className="mt-1.5 max-w-md text-[13.5px] text-ink-2">
									Ask about your spending, invoices and documents. Every answer shows its sources and the steps behind
									it, and changes are only proposed for you to approve.
								</p>
								<div className="mt-6 flex w-full max-w-md flex-col text-left">
									{suggestions.map((text, i) => (
										<button
											key={text}
											type="button"
											onClick={() => void ask(text)}
											className="flex items-center gap-2 rounded-[7px] border-b border-line px-2 py-2 text-[13px] text-ink transition-colors duration-100 hover:bg-hover-2"
											style={{ animation: `fade-up 350ms cubic-bezier(0.23,1,0.32,1) ${i * 70}ms both` }}
										>
											<CornerDownRight className="size-3 shrink-0 text-ink-3" />
											{text}
										</button>
									))}
								</div>
							</div>
						)}

						{messages.map((m) =>
							m.role === "user" ? (
								<div key={m.id} className="flex justify-end pl-14">
									<div
										className="rounded-xl bg-field px-3 py-2 text-[14px] leading-[1.45] whitespace-pre-wrap text-ink"
										style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}
									>
										{m.content}
									</div>
								</div>
							) : m.pending ? (
								<Thinking key={m.id} />
							) : m.error ? (
								<div key={m.id} className="flex items-center gap-3 rounded-card bg-red-tint px-3 py-2.5 text-[13px] text-ink">
									<span className="flex-1">{m.content}</span>
									{m.question && (
										<Button variant="secondary" size="xs" onClick={() => void ask(m.question!, m.id)}>
											Try again
										</Button>
									)}
								</div>
							) : (
								<div key={m.id} className="flex flex-col gap-2">
									{m.answer && <WorkTrace steps={m.answer.steps} sql={m.answer.sql} elapsedMs={m.elapsedMs} />}
									<Answer
										content={m.content}
										sources={m.answer?.sources}
										showEvidenceNote={
											!!m.answer && !m.answer.sources.length && !m.answer.steps.some((s) => DATA_TOOLS.has(s.tool))
										}
										onRetry={m.question && !busy ? () => void ask(m.question!, m.id) : undefined}
									>
										{proposals
											.filter((p) => m.answer?.proposals.includes(p.id))
											.map((p) => (
												<ProposalCard key={p.id} proposal={p} />
											))}
									</Answer>
								</div>
							)
						)}

						{waiting.length > 0 && (
							<div className="flex flex-col gap-2">
								<p className="text-[12px] font-medium text-ink-2">Waiting for your decision</p>
								{waiting.map((p) => (
									<ProposalCard key={p.id} proposal={p} />
								))}
							</div>
						)}
						<div ref={bottomRef} />
					</div>
				</div>

				<div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
					<PromptBar onSend={(text) => void ask(text)} busy={busy} />
					<p className="mt-2 text-center text-[11.5px] text-ink-3">
						Lumen cites its sources and only proposes changes; nothing is applied until you approve it.
					</p>
				</div>
			</div>
		</DashboardShell>
	);
}
