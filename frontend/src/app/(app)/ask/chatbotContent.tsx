"use client";

// Ask Lumen: conversations with the agent (threads; it remembers the thread's last few turns). Every answer shows
// its sources, the steps behind it, and any change it proposes. Opening Ask starts a fresh chat; past chats are in
// the rail. /ask?q=… (the Ask anything palette) starts a new chat with that question, once.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { History, Paperclip, Plus } from "lucide-react";
import { Answer } from "@/components/ask/answer";
import { Button } from "@/components/ask/button";
import { PromptBar } from "@/components/ask/prompt-bar";
import { ProposalCard } from "@/components/ask/proposal-card";
import { Thinking, WorkTrace } from "@/components/ask/work-trace";
import { DashboardShell } from "@/components/dashboard-shell";
import { useProfile } from "@/components/profile/profile-provider";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { agentApi, chatApi, homeApi, type ChatAnswer, type ChatThread, type Proposal } from "@/lib/api/client";
import { suggestedQuestions } from "@/lib/home-math";
import { toast } from "@/lib/toast";
import { ThreadRail } from "./thread-rail";

type Message = {
	id: string;
	role: "user" | "assistant";
	content: string;
	/** the question an assistant message answers, for "ask again" */
	question?: string;
	/** the invoice attached to that question, resent on retry */
	file?: File;
	/** evidence; only live answers have it (history stores the text) */
	answer?: ChatAnswer;
	elapsedMs?: number;
	pending?: boolean;
	error?: boolean;
	/** the free allowance ran out, or the user's key was rejected: point at Settings */
	keyIssue?: boolean;
};

// Tools whose results are the user's own data; an answer built on them has evidence even without a cited passage.
const DATA_TOOLS = new Set(["run_sql", "get_invoice", "get_anomalies", "forecast", "lookup_vendors"]);

function greeting() {
	const hour = new Date().getHours();
	return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const KEY_CODES = ["needs_key", "key_rejected"];

function errorCode(error: unknown): string | undefined {
	return (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
}

function errorMessage(error: unknown): string {
	return (
		(error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
		"Lumen couldn't answer right now. Please try again."
	);
}

export default function ChatbotContent() {
	const firstName = useProfile().profile?.display_name?.split(" ")[0];
	const [messages, setMessages] = useState<Message[]>([]);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [proposals, setProposals] = useState<Proposal[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [threads, setThreads] = useState<ChatThread[]>([]);
	const [threadId, setThreadId] = useState<string | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const lastQ = useRef<string | null>(null); // the ?q= already handed off (StrictMode runs effects twice)
	const router = useRouter();
	const params = useSearchParams();
	const q = params.get("q");
	const draftParam = params.get("draft");
	const lastDraft = useRef<string | null>(null);
	// Bumped whenever the chat on screen changes (new chat, opening a thread). An answer that arrives for an older chat
	// must not touch this one: it is already saved to its own thread, so it only refreshes the list.
	const chatGen = useRef(0);
	const [draft, setDraft] = useState<{ text: string; key: number } | null>(null);
	const busy = messages.some((m) => m.pending);

	const refreshThreads = useCallback(() => {
		chatApi.threads().then(setThreads, () => {});
	}, []);

	useEffect(() => {
		Promise.allSettled([chatApi.getSuggestions(), homeApi.summary(), agentApi.proposals(), chatApi.threads()]).then(
			([suggested, summary, pending, list]) => {
				const server = suggested.status === "fulfilled" ? (suggested.value.suggestions ?? []) : [];
				const found = summary.status === "fulfilled" ? summary.value.found : [];
				setSuggestions(suggestedQuestions(found, server));
				if (pending.status === "fulfilled") setProposals(pending.value);
				if (list.status === "fulfilled") setThreads(list.value);
				setLoaded(true);
			}
		);
	}, []);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [messages]);

	// the Ask anything palette hands over /ask?q=…: a new chat, sent once, then the URL is cleaned so a reload doesn't resend
	// (Ask stays mounted when the palette is used from here, so this runs for every new ?q=, not just on first load)
	useEffect(() => {
		if (q === null) {
			lastQ.current = null;
			return;
		}
		if (lastQ.current === q) return;
		lastQ.current = q;
		router.replace("/ask");
		if (!q.trim()) return;
		newChat();
		void ask(q.trim(), undefined, undefined, null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q]);

	// /ask?draft=… (Lumen found, Bills "How to cancel"): a new chat with the question typed in but NOT sent, so you can
	// edit it first; the URL is cleaned so a reload starts empty
	useEffect(() => {
		if (draftParam === null) {
			lastDraft.current = null;
			return;
		}
		if (lastDraft.current === draftParam) return;
		lastDraft.current = draftParam;
		router.replace("/ask");
		newChat();
		setDraft({ text: draftParam, key: Date.now() });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftParam]);

	async function ask(question: string, file?: File, replaceId?: string, inThread: string | null = threadId) {
		const id = crypto.randomUUID();
		const started = Date.now();
		setMessages((list) => [
			...list.filter((m) => m.id !== replaceId),
			...(replaceId ? [] : [{ id: `${id}-q`, role: "user" as const, content: question, file }]),
			{ id, role: "assistant", content: "", question, file, pending: true },
		]);
		const gen = chatGen.current;
		try {
			const answer = await chatApi.sendMessage(question, file, inThread);
			if (gen !== chatGen.current) return refreshThreads();
			if (!inThread) {
				setThreadId(answer.thread_id);
				refreshThreads();
			}
			if (answer.proposals.length) setProposals(await agentApi.proposals());
			setMessages((list) =>
				list.map((m) =>
					m.id === id
						? { ...m, content: answer.response, answer, elapsedMs: Date.now() - started, pending: false }
						: m
				)
			);
		} catch (error) {
			if (gen !== chatGen.current) return;
			setMessages((list) =>
				list.map((m) => (m.id === id ? { ...m, content: errorMessage(error), pending: false, error: true, keyIssue: KEY_CODES.includes(errorCode(error) ?? "") } : m))
			);
		}
	}

	function newChat() {
		chatGen.current++;
		setThreadId(null);
		setMessages([]);
		setHistoryOpen(false);
	}

	async function openThread(id: string) {
		chatGen.current++;
		setHistoryOpen(false);
		try {
			const { messages: rows } = await chatApi.thread(id);
			setThreadId(id);
			setMessages(rows.map((m) => ({ id: m.id, role: m.role, content: m.content })));
		} catch {
			toast.error("Couldn't open that chat.");
		}
	}

	async function deleteThread(id: string) {
		try {
			await chatApi.deleteThread(id);
			setThreads((list) => list.filter((t) => t.id !== id));
			if (id === threadId) newChat();
		} catch {
			toast.error("Couldn't delete that chat.");
		}
	}

	const railProps = { threads, activeId: threadId, onSelect: (id: string) => void openThread(id), onNew: newChat,
		onDelete: (id: string) => void deleteThread(id), disabled: busy };

	// Proposals filed by answers on screen show under that answer; older pending ones gather at the end.
	const shown = new Set(messages.flatMap((m) => [...(m.answer?.proposals ?? []), m.answer?.attachment?.proposal_id ?? ""]));
	const waiting = proposals.filter((p) => p.type !== "save_invoice" && !shown.has(p.id));

	const proposalCards = (list: Proposal[]) => list.map((p) => <ProposalCard key={p.id} proposal={p} />);
	const waitingBlock = waiting.length > 0 && (
		<div className="flex w-full flex-col gap-2">
			<span className="bui-label text-ink-3">Waiting for your decision</span>
			{proposalCards(waiting)}
		</div>
	);

	return (
		<DashboardShell contentClassName="p-0 sm:p-0 lg:p-0 gap-0">
			<div className="bui flex h-[calc(100dvh-3.5rem)] md:h-dvh">
				<aside className="hidden w-[248px] shrink-0 border-r border-line lg:block">
					<ThreadRail {...railProps} />
				</aside>
				<Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
					<SheetContent side="left" className="bui w-[280px] p-0">
						<SheetTitle className="sr-only">Past chats</SheetTitle>
						<ThreadRail {...railProps} />
					</SheetContent>
				</Sheet>
				<div className="relative flex min-w-0 flex-1 flex-col" data-testid="ask-column">
				<div className="absolute top-3 right-4 z-10 flex gap-1.5 md:right-16 lg:hidden">
					<Button variant="quiet" size="xs" onClick={() => setHistoryOpen(true)}>
						<History className="size-3.5" /> History
					</Button>
					{messages.length > 0 && (
						<Button variant="quiet" size="xs" onClick={newChat} disabled={busy}>
							<Plus className="size-3.5" /> New chat
						</Button>
					)}
				</div>

				{loaded && messages.length === 0 ? (
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[8vh]">
						<div className="flex w-full max-w-2xl flex-col items-center" style={{ animation: "fade-up 600ms both" }}>
							<span className="bui-label text-ink-3">Ask Lumen</span>
							<h1 className="mt-5 text-center font-display text-[40px] leading-[1.05] font-light text-ink sm:text-[52px]">
								{greeting()}{firstName ? `, ${firstName}` : ""}.
								<br />
								What shall we <em>look into</em>?
							</h1>
							<p className="mt-4 max-w-md text-center text-[16px] leading-relaxed font-light text-ink-2">
								Ask about spending, invoices or contracts. Answers come with their sources.
							</p>
							<div className="mt-8 w-full">
								<PromptBar key={draft?.key} initial={draft?.text} hero onSend={(text, file) => { setDraft(null); void ask(text, file); }} busy={busy} />
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
										<div key={m.id} className="flex flex-col items-end gap-1.5 pl-14"
											style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
											{m.file && (
												<div className="flex max-w-full items-center gap-2 rounded-xl border border-border/70 px-3 py-2 text-[13px] text-muted-foreground">
													<Paperclip className="size-3.5 shrink-0" aria-hidden />
													<span className="truncate">{m.file.name}</span>
												</div>
											)}
											<div className="rounded-[18px] bg-field px-4 py-2.5 text-[15px] leading-[1.5] whitespace-pre-wrap text-ink">
												{m.content}
											</div>
										</div>
									) : m.pending ? (
										<Thinking key={m.id} />
									) : m.error ? (
										<div key={m.id} className="flex items-center gap-3 rounded-2xl bg-red-tint px-4 py-3 text-[14px] text-ink">
											<span className="flex-1">{m.content}</span>
											{m.keyIssue && (
												<Link href="/settings" className="underline underline-offset-2">
													Open Settings
												</Link>
											)}
											{m.question && (
												<Button variant="secondary" size="xs" onClick={() => void ask(m.question!, m.file, m.id)}>
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
												attachment={m.answer?.attachment}
												followUp={m.id === messages[messages.length - 1].id && !busy ? m.answer?.follow_up : null}
												onFollowUp={(text) => void ask(text)}
												onRetry={m.question && !busy ? () => void ask(m.question!, m.file, m.id) : undefined}
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
							<PromptBar key={draft?.key} initial={draft?.text} onSend={(text, file) => { setDraft(null); void ask(text, file); }} busy={busy} />
							<p className="mt-2 text-center text-[11.5px] text-ink-3">
								Lumen cites its sources and only proposes changes; nothing is applied until you approve it.
							</p>
						</div>
					</>
				)}
				</div>
			</div>
		</DashboardShell>
	);
}
