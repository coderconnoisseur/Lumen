"use client";

// Bare-bones CSV statement import (SPEC-STATEMENTS). The real screen comes with the UI refactor.
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import { useProfile } from "@/components/profile/profile-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	statementApi,
	type StatementMapping,
	type StatementPreview,
	type StatementResult,
} from "@/lib/api/client";
import { CURRENCIES, currencyLabel } from "@/lib/currency";

type ApiError = { response?: { data?: { error?: string; detail?: { raw?: string[][] } } } };

const FIELDS: { key: keyof StatementMapping; label: string }[] = [
	{ key: "date", label: "Date" },
	{ key: "description", label: "Description" },
	{ key: "debit", label: "Debit" },
	{ key: "credit", label: "Credit" },
	{ key: "amount", label: "Amount" },
	{ key: "drcr", label: "Dr/Cr" },
];

const selectClass = "h-9 rounded-md border border-input bg-background text-foreground px-2 text-sm";

export default function ImportContent() {
	const { profile } = useProfile();
	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<StatementPreview | null>(null);
	const [mapping, setMapping] = useState<StatementMapping | null>(null);
	const [currency, setCurrency] = useState(profile?.currency ?? "USD");
	const [busy, setBusy] = useState<"preview" | "import" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [raw, setRaw] = useState<string[][] | null>(null);
	const [result, setResult] = useState<StatementResult | null>(null);

	function fail(e: unknown, fallback: string) {
		const data = (e as ApiError).response?.data;
		setError(data?.error ?? fallback);
		setRaw(data?.detail?.raw ?? null);
	}

	async function choose(f: File | null) {
		setFile(f);
		setPreview(null);
		setMapping(null);
		setResult(null);
		setError(null);
		setRaw(null);
		if (!f) return;
		setBusy("preview");
		try {
			const p = await statementApi.preview(f);
			setPreview(p);
			setMapping(p.mapping);
		} catch (e) {
			fail(e, "Couldn't read that file.");
		} finally {
			setBusy(null);
		}
	}

	async function run() {
		if (!file || !preview || !mapping) return;
		setBusy("import");
		setError(null);
		setRaw(null);
		try {
			setResult(await statementApi.import(file, mapping, currency, preview.header_line));
		} catch (e) {
			fail(e, "Couldn't import that statement.");
		} finally {
			setBusy(null);
		}
	}

	const money = (n: number | null) => (n == null ? "—" : n.toFixed(2));

	return (
		<DashboardShell
			title="Import a statement"
			description="CSV from your bank or card. Spending lines become transactions; credits are skipped for now."
		>
			<Card className="space-y-4 p-4">
				<div className="flex flex-col gap-1">
					<label htmlFor="statement-file" className="text-sm font-medium">
						Statement file (CSV)
					</label>
					<input
						id="statement-file"
						type="file"
						accept=".csv,text/csv"
						onChange={(e) => void choose(e.target.files?.[0] ?? null)}
						className="text-sm"
					/>
					{busy === "preview" && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Reading the file…
						</p>
					)}
				</div>

				{preview && mapping && (
					<>
						<div className="flex flex-wrap gap-3">
							{FIELDS.map(({ key, label }) => (
								<div key={key} className="flex flex-col gap-1">
									<label htmlFor={`map-${key}`} className="text-xs font-medium">
										{label}
									</label>
									<select
										id={`map-${key}`}
										value={mapping[key] ?? ""}
										onChange={(e) =>
											setMapping({ ...mapping, [key]: e.target.value === "" ? null : Number(e.target.value) })
										}
										className={selectClass}
									>
										<option value="">—</option>
										{preview.columns.map((c, i) => (
											<option key={i} value={i}>
												{c || `Column ${i + 1}`}
											</option>
										))}
									</select>
								</div>
							))}
							<div className="flex flex-col gap-1">
								<label htmlFor="import-currency" className="text-xs font-medium">
									Currency
								</label>
								<select
									id="import-currency"
									value={currency}
									onChange={(e) => setCurrency(e.target.value)}
									className={selectClass}
								>
									{CURRENCIES.map((c) => (
										<option key={c} value={c}>
											{currencyLabel(c)}
										</option>
									))}
								</select>
							</div>
						</div>

						<table className="w-full text-sm">
							<thead>
								<tr className="text-left text-muted-foreground">
									<th className="py-1">Date</th>
									<th>Description</th>
									<th className="text-right">Amount</th>
									<th className="pl-4">Kind</th>
								</tr>
							</thead>
							<tbody>
								{preview.sample.map((s) => (
									<tr key={s.line} className="border-t">
										<td className="py-1">{s.date ?? "—"}</td>
										<td>{s.description}</td>
										<td className="text-right tabular-nums">{money(s.amount)}</td>
										<td className="pl-4">{s.kind ?? "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
						<p className="text-sm text-muted-foreground tabular-nums">
							{preview.counts.rows} rows · {preview.counts.debits} debits · {preview.counts.credits} credits ·{" "}
							{preview.counts.unreadable} unreadable
						</p>

						<Button onClick={() => void run()} disabled={busy !== null}>
							{busy === "import" && <Loader2 className="size-4 animate-spin" />}
							Import
						</Button>
					</>
				)}

				{error && (
					<div role="alert" className="space-y-2 text-sm text-destructive">
						<p>{error}</p>
						{raw && (
							<table className="text-xs text-foreground">
								<tbody>
									{raw.map((r, i) => (
										<tr key={i} className="border-t">
											{r.map((c, j) => (
												<td key={j} className="pr-3">
													{c}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				)}

				{result && (
					<p role="status" className="text-sm tabular-nums">
						Imported {result.imported} · {result.duplicates} duplicates · {result.matched} already recorded ·{" "}
						{result.credits} credits skipped
						{result.unreadable.length > 0 && ` · unreadable lines: ${result.unreadable.join(", ")}`}.{" "}
						<Link href="/home" className="underline">
							See the dashboard
						</Link>
					</p>
				)}
			</Card>
		</DashboardShell>
	);
}
