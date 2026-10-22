import { PageCard } from "@/components/page/page-card";
import { useMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

// Spending's hero: the period's total and how it compares (the chart joins in Task B4).
export function SpendingHero({
	label,
	prevLabel,
	total,
	delta,
	loading,
}: {
	label: string;
	prevLabel: string;
	total: number;
	delta: { abs: number; pct: number } | null;
	loading: boolean;
}) {
	const money = useMoney();
	return (
		<PageCard title={`Spent in ${label}`} loading={loading} skeletonHeight={300} data-testid="spending-hero">
			<div className="text-[36px] leading-tight font-medium tracking-tight tabular-nums">{money(Math.round(total))}</div>
			<div className="h-5 text-[13px] text-muted-foreground">
				{delta && Math.round(delta.abs) !== 0 && (
					<span data-testid="spending-delta">
						<b className={cn("font-medium", delta.abs < 0 ? "text-good" : "text-bad")}>
							{delta.abs < 0 ? "−" : "+"}
							{money(Math.abs(Math.round(delta.abs)))} ({Math.abs(Math.round(delta.pct))}%)
						</b>{" "}
						vs {prevLabel}
					</span>
				)}
			</div>
		</PageCard>
	);
}
