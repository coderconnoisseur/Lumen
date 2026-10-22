import { PageCard } from "@/components/page/page-card";
import { VendorChip } from "@/components/page/vendor-chip";
import { useMoney } from "@/lib/format";

// Who the money went to this period, biggest first.
export function TopMerchants({ rows, loading }: { rows: { vendor: string; amount: number; count: number; category: string | null }[]; loading: boolean }) {
	const money = useMoney();
	return (
		<PageCard title="Top merchants" loading={loading} skeletonHeight={300} data-testid="top-merchants">
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">No merchants in this period.</p>
			) : (
				rows.map((r) => (
					<div key={r.vendor} data-testid="merchant-row" className="flex items-center gap-2.5 border-b border-border/60 py-2 text-[13px] last:border-0">
						<VendorChip name={r.vendor} />
						<span className="min-w-0 flex-1">
							<span className="block truncate">{r.vendor}</span>
							<span className="block truncate text-[11.5px] text-muted-foreground">
								{r.count} {r.count === 1 ? "payment" : "payments"}
								{r.category ? ` · ${r.category}` : ""}
							</span>
						</span>
						<span className="shrink-0 font-medium tabular-nums">{money(Math.round(r.amount))}</span>
					</div>
				))
			)}
		</PageCard>
	);
}
