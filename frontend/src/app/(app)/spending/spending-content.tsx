"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page/page-header";
import { useMoney } from "@/lib/format";
import { cumulative, dayIndex, sameDayDelta } from "@/lib/home-math";
import { byCategory, monthlyTotals, needsCategory, spendPeriods, type Choice } from "@/lib/spending-math";
import { cn } from "@/lib/utils";
import { Brief } from "../home/_components/brief";
import { LumenFound } from "../home/_components/lumen-found";
import { ByCategory } from "./_components/by-category";
import { SpendingHero } from "./_components/hero";
import { useSpendingData } from "./use-spending-data";

const CHOICES: { label: string; value: Exclude<Choice, object> }[] = [
	{ label: "This month", value: "this-month" },
	{ label: "Last month", value: "last-month" },
	{ label: "3M", value: "3M" },
	{ label: "YTD", value: "YTD" },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromInput = (s: string) => {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
};
const dayMonth = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Spending (UI revamp Phase 5b, spec 2026-10-22 §4.2): where did my money go, and is anything off?
export default function SpendingContent() {
	const money = useMoney();
	const today = useMemo(() => {
		const n = new Date();
		return new Date(n.getFullYear(), n.getMonth(), n.getDate());
	}, []);
	const [preset, setPreset] = useState<Exclude<Choice, object> | "custom">("this-month");
	const [custom, setCustom] = useState({ from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) });
	const [compare, setCompare] = useState(true);
	const choice: Choice = preset === "custom" ? { from: fromInput(custom.from), to: fromInput(custom.to) } : preset;
	const p = spendPeriods(choice, today);
	const data = useSpendingData(choice, today);
	// the category filter lives in the URL (?category=), so it survives a reload and can be linked to
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const category = params.get("category");
	const setCategory = (c: string | null) => {
		const next = new URLSearchParams(params.toString());
		if (c) next.set("category", c);
		else next.delete("category");
		const q = next.toString();
		router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
	};

	const t = Math.min(Math.max(dayIndex(p.current, today), 0), p.current.days - 1);
	const cur = cumulative(data.txns, p.current);
	const prev = cumulative(data.prevTxns, p.previous);
	const total = cur[t] ?? 0;
	const delta = sameDayDelta(cur, prev, t);

	// "Shopping is most of the jump, and one Croma order is ₹9,999 of it." only when it's true; otherwise the total.
	const brief = (() => {
		if (data.status === "loading") return null;
		const cats = byCategory(data.txns, data.prevTxns);
		const top = [...cats].sort((a, b) => b.change - a.change)[0];
		if (delta && delta.abs > 0 && top && top.change > delta.abs * 0.4) {
			const biggest = data.txns.filter((x) => (x.category || "Uncategorised") === top.category).sort((a, b) => (b.total_amount ?? 0) - (a.total_amount ?? 0))[0];
			return `${top.category} is most of the jump${biggest?.vendor_name ? `, and one ${biggest.vendor_name} payment is ${money(biggest.total_amount ?? 0)} of it` : ""}.`;
		}
		return `You've spent ${money(Math.round(total))} in ${p.label}${preset === "this-month" ? " so far" : ""}.`;
	})();

	return (
		<div className="relative flex-1">
			<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[image:var(--band)]" />
			<div className="relative px-4 py-6 sm:px-6 lg:px-8">
				<PageHeader title="Spending" brief={<Brief text={brief} />}>
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex gap-0.5 rounded-[9px] border border-border/60 bg-card/60 p-0.5">
							{[...CHOICES, { label: "Custom", value: "custom" as const }].map((c) => (
								<button
									key={c.value}
									type="button"
									aria-pressed={preset === c.value}
									onClick={() => setPreset(c.value)}
									className={cn(
										"label-ui rounded-[7px] px-3 py-1 transition-colors",
										preset === c.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
									)}
								>
									{c.label}
								</button>
							))}
						</div>
						{preset === "custom" && (
							<div className="flex items-center gap-2 text-[13px]">
								<label className="flex items-center gap-1.5">
									From
									<input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="rounded-md border border-border bg-card px-2 py-1" />
								</label>
								<label className="flex items-center gap-1.5">
									To
									<input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="rounded-md border border-border bg-card px-2 py-1" />
								</label>
							</div>
						)}
						<button
							type="button"
							role="switch"
							aria-checked={compare}
							onClick={() => setCompare((v) => !v)}
							className="label-ui flex items-center gap-2 text-foreground/80"
						>
							<span className={cn("relative h-[18px] w-8 rounded-full transition-colors", compare ? "bg-primary" : "bg-muted-foreground/30")}>
								<span className={cn("absolute top-0.5 size-3.5 rounded-full bg-white transition-[left]", compare ? "left-[15px]" : "left-0.5")} />
							</span>
							Compare with {p.prevLabel}
						</button>
						<span className="label-ui ml-auto text-muted-foreground">
							{dayMonth(p.current.start)} – {dayMonth(p.current.end < today ? p.current.end : today)}
						</span>
					</div>
				</PageHeader>
				<SpendingHero
					label={p.label}
					prevLabel={p.prevLabel}
					total={total}
					delta={compare ? delta : null}
					period={p.current}
					cur={cur}
					prev={compare ? prev : null}
					t={t}
					months={monthlyTotals(data.recent, today, 6)}
					mainMonths={
						preset === "3M" || preset === "YTD"
							? monthlyTotals(data.txns, today, (today.getFullYear() - p.current.start.getFullYear()) * 12 + today.getMonth() - p.current.start.getMonth() + 1)
							: null
					}
					today={today}
					loading={data.status === "loading"}
				/>
				<div className="mt-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
					<ByCategory
						rows={byCategory(data.txns, data.prevTxns)}
						compare={compare}
						selected={category}
						onSelect={setCategory}
						needsCategory={needsCategory(data.txns)}
						loading={data.status === "loading"}
					/>
					<LumenFound title="Lumen noticed" summary={data.summary} loading={data.status === "loading"} />
				</div>
			</div>
		</div>
	);
}
