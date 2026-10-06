"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	documentsApi,
	type DocumentAnswer,
	type LumenDocument,
} from "@/lib/api/client";
import { toast } from "@/lib/toast";

const DOC_TYPES = [
	{ value: "purchase_order", label: "Purchase order" },
	{ value: "contract", label: "Contract" },
	{ value: "policy", label: "Policy" },
	{ value: "invoice", label: "Invoice" },
	{ value: "other", label: "Other" },
];

function errorMessage(error: unknown, fallback: string): string {
	const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
	return data?.error ?? fallback;
}

export default function DocumentsContent() {
	const [documents, setDocuments] = useState<LumenDocument[]>([]);
	const [loading, setLoading] = useState(true);
	const [uploading, setUploading] = useState(false);
	const [docType, setDocType] = useState("contract");
	const [question, setQuestion] = useState("");
	const [asking, setAsking] = useState(false);
	const [answer, setAnswer] = useState<DocumentAnswer | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		try {
			setDocuments(await documentsApi.list());
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't load your documents."));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	async function onUpload(file: File | undefined) {
		if (!file) return;
		setUploading(true);
		try {
			const doc = await documentsApi.upload(file, docType);
			toast.success(`Indexed "${doc.title}" (${doc.chunk_count} sections)`);
			await refresh();
		} catch (error) {
			toast.error(errorMessage(error, "Upload failed."));
		} finally {
			setUploading(false);
			if (fileInput.current) fileInput.current.value = "";
		}
	}

	async function onDelete(doc: LumenDocument) {
		try {
			await documentsApi.remove(doc.id);
			setDocuments((docs) => docs.filter((d) => d.id !== doc.id));
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't delete the document."));
		}
	}

	async function onAsk(event: React.FormEvent) {
		event.preventDefault();
		if (!question.trim()) return;
		setAsking(true);
		setAnswer(null);
		try {
			setAnswer(await documentsApi.ask(question.trim()));
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't answer right now."));
		} finally {
			setAsking(false);
		}
	}

	return (
		<DashboardShell
			title="Documents"
			description="Upload purchase orders, contracts and policies, then ask questions. Answers cite the passages they come from."
			eyebrow="Knowledge"
		>
			<Card className="space-y-4 p-6">
				<form onSubmit={onAsk} className="flex flex-col gap-3 sm:flex-row">
					<Input
						value={question}
						onChange={(e) => setQuestion(e.target.value)}
						placeholder="e.g. What are the payment terms on PO-U1-202605-06?"
						maxLength={500}
					/>
					<Button type="submit" disabled={asking || !question.trim()}>
						{asking ? <Loader2 className="size-4 animate-spin" /> : "Ask"}
					</Button>
				</form>
				{answer && (
					<div className="space-y-3">
						<p className={answer.abstained ? "text-muted-foreground" : ""}>{answer.answer}</p>
						{answer.sources.length > 0 && (
							<div className="space-y-2">
								<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
								{answer.sources.map((s) => (
									<div key={s.chunk_id} className="rounded-md border border-border/70 p-3 text-sm">
										<p className="font-medium">
											{s.title}
											{s.section ? ` · ${s.section}` : ""}
										</p>
										<p className="mt-1 text-muted-foreground">{s.text}</p>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</Card>

			<Card className="space-y-4 p-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h2 className="text-lg font-semibold">Your documents</h2>
					<div className="flex items-center gap-2">
						<select
							value={docType}
							onChange={(e) => setDocType(e.target.value)}
							className="h-9 rounded-md border border-input bg-background px-2 text-sm"
							aria-label="Document type"
						>
							{DOC_TYPES.map((t) => (
								<option key={t.value} value={t.value}>
									{t.label}
								</option>
							))}
						</select>
						<input
							ref={fileInput}
							type="file"
							accept="application/pdf"
							className="hidden"
							onChange={(e) => void onUpload(e.target.files?.[0])}
						/>
						<Button onClick={() => fileInput.current?.click()} disabled={uploading}>
							{uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
							Upload PDF
						</Button>
					</div>
				</div>
				{loading ? (
					<p className="text-sm text-muted-foreground">Loading…</p>
				) : documents.length === 0 ? (
					<p className="text-sm text-muted-foreground">No documents yet. Upload a PDF to start asking questions about it.</p>
				) : (
					<ul className="divide-y divide-border/70">
						{documents.map((doc) => (
							<li key={doc.id} className="flex items-center justify-between gap-3 py-3">
								<div className="flex min-w-0 items-center gap-3">
									<FileText className="size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="truncate font-medium">{doc.title}</p>
										<p className="text-xs text-muted-foreground">
											{DOC_TYPES.find((t) => t.value === doc.doc_type)?.label ?? doc.doc_type} · {doc.chunk_count} sections
										</p>
									</div>
								</div>
								<Button variant="ghost" size="icon" aria-label={`Delete ${doc.title}`} onClick={() => void onDelete(doc)}>
									<Trash2 className="size-4" />
								</Button>
							</li>
						))}
					</ul>
				)}
			</Card>
		</DashboardShell>
	);
}
