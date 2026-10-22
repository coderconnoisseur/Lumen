import Link from "next/link";
import { Copy, ReceiptText, RefreshCw, TrendingUp, type LucideIcon } from "lucide-react";
import type { FoundItem, HomeSummary } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { fill } from "@/lib/home-math";
import { PageCard } from "@/components/page/page-card";

// How each kind looks and what its link does. A row only links somewhere it can be acted on (spec 2026-10-22 §4.1).
const KIND: Record<FoundItem["kind"], { icon: LucideIcon; tint: string; action: string }> = {
	duplicate: { icon: Copy, tint: "bg-bad/10 text-bad", action: "Review duplicate" },
	review: { icon: ReceiptText, tint: "bg-primary/10 text-primary", action: "Review receipts" },
	spike: { icon: TrendingUp, tint: "bg-amber-500/10 text-amber-700", action: "See in Spending" },
	price_rise: { icon: RefreshCw, tint: "bg-primary/10 text-primary", action: "See the charges" },
};

// What "Ask Lumen" types into Ask for you (not sent: you can edit it first).
export const askAbout = (item: FoundItem, money: (n: number) => string) =>
	`Tell me more about this: ${fill(item.headline, item.amounts, money).replace(/\.$/, "")}`;

// "Lumen found": duplicates, receipts to review, spending spikes and price rises (GET /api/home/summary, rule-based).
// A money "worth" is only claimed for things you may get back (duplicates).
export function LumenFound({ summary, loading }: { summary: HomeSummary | null; loading: boolean }) {
	const money = useMoney();
	const found = summary?.found ?? [];
	const total = found.length + (summary?.more ?? 0);
	return (
		<PageCard
			title="Lumen found"
			extra={
				found.length > 0 && (
					<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] text-primary">
						{total} to look at
						{summary!.worth_total > 0 && ` · ${money(summary!.worth_total)} you may get back`}
					</span>
				)
			}
			loading={loading}
			skeletonHeight={132}
			data-testid="lumen-found"
		>
			{found.length === 0 ? (
				<p className="font-serif text-[17px] text-muted-foreground">Nothing needs you right now.</p>
			) : (
				found.map((f, i) => {
					const { icon: Icon, tint, action } = KIND[f.kind] ?? KIND.review;
					return (
						<div key={i} data-testid="found-row" className="flex gap-3 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
							<span className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] ${tint}`}>
								<Icon className="size-4" />
							</span>
							<div className="min-w-0">
								<p className="text-[14px] leading-snug font-medium">{fill(f.headline, f.amounts, money)}</p>
								<p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{fill(f.detail, f.amounts, money)}</p>
								<div className="mt-1.5 flex gap-3.5 text-[12.5px] font-medium">
									{f.href && (
										<Link href={f.href} className="text-primary hover:underline">
											{action}
										</Link>
									)}
									<Link href={`/ask?draft=${encodeURIComponent(askAbout(f, money))}`} className="text-muted-foreground hover:text-foreground">
										Ask Lumen
									</Link>
								</div>
							</div>
						</div>
					);
				})
			)}
		</PageCard>
	);
}
