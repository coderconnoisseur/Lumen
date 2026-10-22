"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, Receipt, Search, Trash2 } from "lucide-react";
import { PageCard } from "@/components/page/page-card";
import { filesApi, type LumenDocument, type ReviewItem, type StatementImport } from "@/lib/api/client";
import { toast } from "@/lib/toast";
import { useMoney } from "@/lib/format";
import { parseUtc, type Txn } from "@/lib/home-math";
import { cn } from "@/lib/utils";

type Kind = "receipt" | "document" | "statement";
export type LibraryRow = {
	key: string;
	kind: Kind;
	title: string;
	sub: string;
	from: "Upload" | "Gmail" | "Import";
	date: string | null;
	amount: number | null;
	review: boolean;
	/** the original upload, when one was kept */
	fileKey?: string | null;
	onDelete?: () => void;
};
const CHIPS: { label: string; kind: Kind | null }[] = [
	{ label: "All", kind: null },
	{ label: "Receipts & invoices", kind: "receipt" },
	{ label: "Statements", kind: "statement" },
	{ label: "Documents", kind: "document" },
];
const ICON = { receipt: Receipt, document: FileText, statement: FileSpreadsheet };
const DOC_TYPE: Record<string, string> = { purchase_order: "Purchase order", contract: "Contract", policy: "Policy", invoice: "Invoice", other: "Document" };
const dayMonth = (s: string | null) => (s ? parseUtc(s).toLocaleString("en-GB", { day: "numeric", month: "short" }) : "—");
const range = (a: string | null, b: string | null) => (a && b ? `${dayMonth(a)} – ${dayMonth(b)}` : "");
const PAGE = 10;

// Everything the user has given Lumen in one list, newest first (spec 2026-10-22 §4.5): receipts and invoices (with
// the ones still in review), documents, and statement imports. Statement lines themselves are transactions, not files,
// so a statement shows once, as its import. Reading/Failed states aren't stored yet, so every file is Done or in review.
export function toRows(d: { review: ReviewItem[]; receipts: Txn[]; documents: LumenDocument[]; imports: StatementImport[] }, remove: (id: string) => void): LibraryRow[] {
	const rows: LibraryRow[] = [
		...d.review.map((r) => ({
			key: `r-${r.id}`, kind: "receipt" as const, title: String(r.invoice.vendor_name ?? "Unknown vendor"),
			sub: `Receipt · ${String(r.invoice.invoice_number ?? "no bill number")}`, from: r.invoice.source === "email" ? ("Gmail" as const) : ("Upload" as const),
			date: r.created_at, amount: typeof r.invoice.total_amount === "number" ? r.invoice.total_amount : null, review: true,
			fileKey: typeof r.invoice.file_key === "string" ? r.invoice.file_key : null,
		})),
		...d.receipts.map((t) => ({
			key: `t-${t.id}`, kind: "receipt" as const, title: t.vendor_name ?? "Unknown vendor",
			sub: `Receipt${t.category ? ` · ${t.category}` : ""}`, from: t.source === "email" ? ("Gmail" as const) : ("Upload" as const),
			date: t.date, amount: t.total_amount, review: false, fileKey: (t as Txn & { file_key?: string | null }).file_key,
		})),
		...d.documents.map((doc) => ({
			key: `d-${doc.id}`, kind: "document" as const, title: doc.title, sub: `${DOC_TYPE[doc.doc_type] ?? "Document"} · ${doc.filename ?? `${doc.chunk_count} sections`}`,
			from: "Upload" as const, date: doc.created_at, amount: null, review: false, fileKey: doc.file_key, onDelete: () => remove(doc.id),
		})),
		...d.imports.map((i) => ({
			key: `i-${i.id}`, kind: "statement" as const, title: i.label ?? i.file_name ?? "Statement",
			sub: `Statement · ${i.lines} lines${i.period_from ? ` · ${range(i.period_from, i.period_to)}` : ""}`, from: "Import" as const,
			date: i.created_at, amount: null, review: false,
		})),
	];
	return rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function Library({ rows }: { rows: LibraryRow[] }) {
	const money = useMoney();
	const [kind, setKind] = useState<Kind | null>(null);
	const [q, setQ] = useState("");
	const [shown, setShown] = useState(PAGE);
	const needle = q.trim().toLowerCase();
	const list = rows.filter((r) => (!kind || r.kind === kind) && (!needle || `${r.title} ${r.sub}`.toLowerCase().includes(needle)));

	return (
		<PageCard title="Everything you've given Lumen" extra={<span className="normal-case tabular-nums">{rows.length} {rows.length === 1 ? "file" : "files"}</span>} skeletonHeight={0} data-testid="library">
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<div className="flex flex-wrap gap-1">
					{CHIPS.filter((c) => !c.kind || rows.some((r) => r.kind === c.kind)).map((c) => (
						<button
							key={c.label}
							type="button"
							aria-pressed={kind === c.kind}
							onClick={() => (setKind(c.kind), setShown(PAGE))}
							className={cn("label-ui rounded-full px-2.5 py-1", kind === c.kind ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
						>
							{c.label}
						</button>
					))}
				</div>
				<label className="ml-auto flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 sm:max-w-64">
					<Search className="size-3.5 shrink-0 text-muted-foreground" />
					<input type="search" aria-label="Search" placeholder="Search vendor or file" value={q} onChange={(e) => (setQ(e.target.value), setShown(PAGE))} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
				</label>
			</div>
			<div className="label-ui grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/70 pb-2 text-muted-foreground sm:grid-cols-[minmax(0,1fr)_72px_64px_88px_96px]">
				<span>File</span>
				<span className="max-sm:hidden">Came from</span>
				<span className="max-sm:hidden">Date</span>
				<span className="text-right max-sm:hidden">Amount</span>
				<span className="text-right">Status</span>
			</div>
			{list.length === 0 && <p className="py-6 text-center text-[13px] text-muted-foreground">{rows.length ? "Nothing matches." : "Nothing here yet. Upload a receipt or import a statement."}</p>}
			{list.slice(0, shown).map((r) => {
				const Icon = ICON[r.kind];
				return (
					<div key={r.key} data-testid="library-row" className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 py-2 text-[13px] last:border-0 sm:grid-cols-[minmax(0,1fr)_72px_64px_88px_96px]">
						<span className="flex min-w-0 items-center gap-2.5">
							<Icon className="size-4 shrink-0 text-muted-foreground" />
							<span className="min-w-0">
								{r.fileKey ? (
									<button
										type="button"
										aria-label={`Open ${r.title}`}
										onClick={() => void filesApi.open(r.fileKey!).catch(() => toast.error("Couldn't open the original."))}
										className="block max-w-full truncate text-left font-medium hover:underline"
									>
										{r.title}
									</button>
								) : (
									<b className="block truncate font-medium">{r.title}</b>
								)}
								<small className="block truncate text-[12px] text-muted-foreground">
									{r.sub}
									<span className="sm:hidden"> · {r.from} · {dayMonth(r.date)}</span>
								</small>
							</span>
						</span>
						<span className="text-muted-foreground max-sm:hidden">{r.from}</span>
						<span className="text-muted-foreground tabular-nums max-sm:hidden">{dayMonth(r.date)}</span>
						<span className="text-right tabular-nums max-sm:hidden">{r.amount === null ? <span className="text-muted-foreground">—</span> : money(r.amount)}</span>
						<span className="flex items-center justify-end gap-1.5">
							<span className={cn("rounded-full px-2 py-0.5 text-[11.5px] whitespace-nowrap", r.review ? "bg-amber-500/10 text-amber-700" : "bg-good/10 text-good")}>
								{r.review ? "Needs review" : "Done"}
							</span>
							{r.onDelete && (
								<button type="button" aria-label={`Delete ${r.title}`} onClick={r.onDelete} className="rounded p-1 text-muted-foreground hover:text-bad">
									<Trash2 className="size-3.5" />
								</button>
							)}
						</span>
					</div>
				);
			})}
			{list.length > shown && (
				<button type="button" onClick={() => setShown((n) => n + 20)} className="label-ui mt-3 text-foreground/80 hover:text-foreground">
					Show {Math.min(20, list.length - shown)} more
				</button>
			)}
		</PageCard>
	);
}
