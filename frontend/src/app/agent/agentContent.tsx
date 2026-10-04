"use client";

// Minimal page to exercise the agent API. The real chat UI comes with the UI refactor.
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { agentApi, type AgentAnswer, type Proposal } from "@/lib/api/client";
import { toast } from "@/lib/toast";

function errorMessage(error: unknown, fallback: string): string {
	return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

export default function AgentContent() {
	const [question, setQuestion] = useState("");
	const [busy, setBusy] = useState(false);
	const [answer, setAnswer] = useState<AgentAnswer | null>(null);
	const [openSource, setOpenSource] = useState<string | null>(null);
	const [proposals, setProposals] = useState<Proposal[]>([]);

	const loadProposals = useCallback(async () => {
		try {
			setProposals(await agentApi.proposals());
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't load proposals."));
		}
	}, []);

	useEffect(() => {
		void loadProposals();
	}, [loadProposals]);

	async function onAsk(event: React.FormEvent) {
		event.preventDefault();
		if (!question.trim()) return;
		setBusy(true);
		setAnswer(null);
		try {
			setAnswer(await agentApi.ask(question.trim()));
			await loadProposals();
		} catch (error) {
			toast.error(errorMessage(error, "The agent couldn't answer right now."));
		} finally {
			setBusy(false);
		}
	}

	async function decide(id: string, decision: "approve" | "reject") {
		try {
			await agentApi.decide(id, decision);
			setProposals((list) => list.filter((p) => p.id !== id));
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't save the decision."));
		}
	}

	return (
		<DashboardShell title="Agent (test)" description="Ask about spending or documents; see which tools ran." eyebrow="Agent">
			<Card className="space-y-4 p-6">
				<form onSubmit={onAsk} className="flex flex-col gap-3 sm:flex-row">
					<Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000}
						placeholder="e.g. What is my average electricity bill? / What's the notice period in the TechHub contract?" />
					<Button type="submit" disabled={busy || !question.trim()}>
						{busy ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
					</Button>
				</form>
				{answer && (
					<div className="space-y-4 text-sm">
						<p className="whitespace-pre-wrap text-base">{answer.answer}</p>
						{answer.sources.length > 0 && (
							<div className="space-y-1">
								<p className="text-xs font-medium uppercase text-muted-foreground">References</p>
								{answer.sources.map((s) => (
									<div key={s.chunk_id}>
										<button type="button" className="text-left underline"
											onClick={() => setOpenSource(openSource === s.chunk_id ? null : s.chunk_id)}>
											{s.title}{s.section ? ` · ${s.section}` : ""}
										</button>
										{openSource === s.chunk_id && <p className="mt-1 rounded border p-2 text-muted-foreground">{s.text}</p>}
									</div>
								))}
							</div>
						)}
						<details>
							<summary className="cursor-pointer text-muted-foreground">
								Show work: {answer.steps.length} tool call(s), {answer.llm_calls} LLM call(s), stopped: {answer.stopped}
							</summary>
							<ol className="mt-2 list-decimal space-y-1 pl-5">
								{answer.steps.map((s, i) => (
									<li key={i}><code>{s.tool}</code> {JSON.stringify(s.args)} → {s.summary} ({s.latency_ms} ms)</li>
								))}
							</ol>
							{answer.sql.map((q, i) => <pre key={i} className="mt-2 overflow-x-auto rounded bg-muted p-2">{q}</pre>)}
						</details>
					</div>
				)}
			</Card>

			<Card className="space-y-3 p-6">
				<h2 className="font-semibold">Pending proposals</h2>
				{proposals.length === 0 ? (
					<p className="text-sm text-muted-foreground">None. Try: “The invoice FM-202606-U1N03 looks like it's in the wrong category; propose Shopping.”</p>
				) : proposals.map((p) => (
					<div key={p.id} className="flex flex-col gap-2 rounded border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p><b>{p.type}</b> on <code>{p.target}</code> · risk {p.risk}</p>
							<p className="text-muted-foreground">{p.reason} {Object.keys(p.payload).length ? JSON.stringify(p.payload) : ""}</p>
						</div>
						<div className="flex gap-2">
							<Button size="sm" onClick={() => void decide(p.id, "approve")}>Approve</Button>
							<Button size="sm" variant="outline" onClick={() => void decide(p.id, "reject")}>Reject</Button>
						</div>
					</div>
				))}
			</Card>
		</DashboardShell>
	);
}
