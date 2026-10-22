"use client";

import { useState } from "react";
import { Download, Pencil, Search } from "lucide-react";
import { PageCard } from "@/components/page/page-card";
import { VendorChip } from "@/components/page/vendor-chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { transactionApi } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { parseDay, type Txn } from "@/lib/home-math";
import { sourceOf, toCsv } from "@/lib/spending-math";
import { toast } from "@/lib/toast";

const PAGE = 25;
const UNSORTED = new Set(["", "Other", "Uncategorised"]);
const dayMonth = (s: string) => parseDay(s).toLocaleString("en-GB", { day: "numeric", month: "short" });
const inCategory = (t: Txn, c: string) => (c === "Uncategorised" ? !t.category || UNSORTED.has(t.category) : t.category === c);

// Spending's transactions (spec §4.2): follows the category picked above, plus a search and a source filter.
// The category pill edits in place: a menu of known categories, saved with PUT /transactions/<id>.
export function Transactions({
	txns,
	category,
	categories,
	onChanged,
	file,
	loading,
}: {
	txns: Txn[];
	category: string | null;
	/** what the edit menu offers */
	categories: string[];
	onChanged: (id: Txn["id"], category: string) => void;
	/** the CSV's name, without the extension */
	file: string;
	loading: boolean;
}) {
	const money = useMoney();
	const [search, setSearch] = useState("");
	const [source, setSource] = useState<"all" | "statement" | "receipt">("all");
	const [shown, setShown] = useState(PAGE);
	const q = search.trim().toLowerCase();
	const rows = [...txns]
		.filter((t) => !category || inCategory(t, category))
		.filter((t) => !q || (t.vendor_name ?? "").toLowerCase().includes(q))
		.filter((t) => source === "all" || (source === "statement") === (t.source === "statement"))
		.sort((a, b) => b.date.localeCompare(a.date));

	async function change(t: Txn, next: string) {
		try {
			await transactionApi.updateTransaction(String(t.id), { category: next });
			onChanged(t.id, next);
		} catch {
			toast.error("Couldn't change that category.");
		}
	}

	function exportCsv() {
		const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `${file}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<PageCard
			title="Transactions"
			extra={<span className="text-[12.5px] text-muted-foreground">{rows.length} {category ? `in ${category}` : "in this period"}</span>}
			action={
				<button type="button" aria-label="Export CSV" title="Export CSV" onClick={exportCsv} className="flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
					<Download className="size-4" />
				</button>
			}
			loading={loading}
			skeletonHeight={420}
			data-testid="transactions"
		>
			<div className="mb-3 flex flex-wrap gap-2">
				<label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[13px]">
					<Search className="size-3.5 text-muted-foreground" />
					<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search merchant" className="min-w-0 flex-1 bg-transparent outline-none" />
				</label>
				<select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px]">
					<option value="all">All sources</option>
					<option value="statement">Statements</option>
					<option value="receipt">Receipts</option>
				</select>
			</div>
			{rows.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">No transactions match.</p>
			) : (
				<div className="text-[13px]">
					{rows.slice(0, shown).map((t) => (
						<div key={t.id} data-testid="txn-row" className="group grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 py-2 last:border-0 sm:grid-cols-[60px_minmax(0,1fr)_150px_96px_90px]">
							<span className="text-muted-foreground">{dayMonth(t.date)}</span>
							<span className="flex min-w-0 items-center gap-2.5">
								<VendorChip name={t.vendor_name ?? "Unknown"} />
								<span className="truncate">{t.vendor_name ?? "Unknown"}</span>
							</span>
							<span className="hidden items-center gap-1 sm:flex">
								<span data-testid="category-pill" className="truncate rounded-full bg-muted px-2 py-0.5 text-[12px]">
									{t.category || "Uncategorised"}
								</span>
								<DropdownMenu>
									<DropdownMenuTrigger
										aria-label={`Change category for ${t.vendor_name ?? "this transaction"}`}
										className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
									>
										<Pencil className="size-3" />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
										{categories.map((c) => (
											<DropdownMenuItem key={c} onSelect={() => void change(t, c)}>
												{c}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							</span>
							<span className="hidden text-muted-foreground sm:block">{sourceOf(t)}</span>
							<span className="text-right font-medium tabular-nums">{money(t.total_amount ?? 0)}</span>
						</div>
					))}
					{rows.length > shown && (
						<button type="button" onClick={() => setShown((n) => n + PAGE)} className="label-ui mt-3 text-primary hover:underline">
							Show more ({rows.length - shown})
						</button>
					)}
				</div>
			)}
		</PageCard>
	);
}
