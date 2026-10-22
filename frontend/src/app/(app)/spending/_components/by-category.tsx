import { PageCard } from "@/components/page/page-card";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// Tints for the bars, in order of spend; the rest share the last one.
const TINTS = ["#2f6fe0", "#c4572f", "#2e8b57", "#b7791f", "#7fa8ee", "#8b6fd6", "#a8a69f"];

// Where the money went (spec 2026-10-22 §4.2): each category's spend, share and change; a click filters the
// transactions below to it. The footer only appears when some rows still have no real category.
export function ByCategory({
	rows,
	compare,
	selected,
	onSelect,
	needsCategory,
	loading,
}: {
	rows: { category: string; amount: number; share: number; change: number }[];
	compare: boolean;
	selected: string | null;
	onSelect: (category: string | null) => void;
	needsCategory: number;
	loading: boolean;
}) {
	const money = useMoney();
	const max = Math.max(...rows.map((r) => r.amount), 1);
	return (
		<PageCard
			title="By category"
			extra={
				selected && (
					<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] text-primary">Filtering transactions: {selected}</span>
				)
			}
			action={
				selected && (
					<button type="button" onClick={() => onSelect(null)} className="label-ui text-muted-foreground hover:text-foreground">
						Clear
					</button>
				)
			}
			loading={loading}
			skeletonHeight={260}
			data-testid="by-category"
		>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">Nothing spent in this period.</p>
			) : (
				<div className="flex flex-col">
					{rows.map((r, i) => (
						<button
							key={r.category}
							type="button"
							data-testid="category-row"
							aria-pressed={selected === r.category}
							onClick={() => onSelect(selected === r.category ? null : r.category)}
							className={cn(
								"-mx-2 grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px] transition-colors sm:grid-cols-[minmax(0,160px)_1fr_90px_48px_64px]",
								selected === r.category ? "bg-primary/8" : "hover:bg-muted/60",
							)}
						>
							<span className="flex min-w-0 items-center gap-2">
								<i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: TINTS[Math.min(i, TINTS.length - 1)] }} />
								<span className="truncate">{r.category}</span>
							</span>
							<span className="h-[5px] overflow-hidden rounded-full bg-muted">
								<i className="block h-full rounded-full" style={{ width: `${(r.amount / max) * 100}%`, background: TINTS[Math.min(i, TINTS.length - 1)] }} />
							</span>
							<span className="text-right font-medium tabular-nums">{money(Math.round(r.amount))}</span>
							<span className="hidden text-right text-[12px] text-muted-foreground tabular-nums sm:block">{Math.round(r.share * 100)}%</span>
							<span className={cn("hidden text-right text-[12px] tabular-nums sm:block", !compare && "invisible", r.change > 0 ? "text-bad" : r.change < 0 ? "text-good" : "text-muted-foreground")}>
								{Math.round(r.change) === 0 ? "same" : `${r.change > 0 ? "+" : "−"}${money(Math.abs(Math.round(r.change)))}`}
							</span>
						</button>
					))}
				</div>
			)}
			{needsCategory > 0 && (
				<div className="mt-3 flex items-center border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">
					{needsCategory} {needsCategory === 1 ? "transaction still needs" : "transactions still need"} a category
					<button type="button" onClick={() => onSelect("Uncategorised")} className="ml-auto font-medium text-primary hover:underline">
						Sort them now
					</button>
				</div>
			)}
		</PageCard>
	);
}
