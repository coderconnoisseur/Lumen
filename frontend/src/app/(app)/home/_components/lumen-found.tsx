import Link from "next/link";
import type { HomeSummary } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { fill } from "@/lib/home-math";
import { HomeCard } from "./card";

// "Lumen found": duplicates, receipts to review, spending spikes and price rises (GET /api/home/summary, rule-based).
// A money "worth" is only claimed for things you may get back (duplicates).
export function LumenFound({ summary, loading }: { summary: HomeSummary | null; loading: boolean }) {
	const money = useMoney();
	const found = summary?.found ?? [];
	const total = found.length + (summary?.more ?? 0);
	return (
		<HomeCard title="Lumen found" loading={loading} skeletonHeight={132} data-testid="lumen-found">
			{found.length === 0 ? (
				<p className="font-serif text-[17px] text-muted-foreground">Nothing needs you right now.</p>
			) : (
				<>
					<h3 className="mb-2.5 text-[15px] font-medium">
						{total} {total === 1 ? "thing" : "things"} worth a look
						{summary!.worth_total > 0 && (
							<span className="text-primary"> · {money(summary!.worth_total)} you may get back</span>
						)}
					</h3>
					<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
						{found.map((f, i) => (
							<div key={i} data-testid="found-tile" className="flex flex-col rounded-xl border border-border bg-background p-3">
								<div className="label-mono text-primary">{f.tag}</div>
								<p className="my-1 font-serif text-[17px] leading-tight">{fill(f.headline, f.amounts, money)}</p>
								<p className="text-[12.5px] leading-snug text-muted-foreground">{fill(f.detail, f.amounts, money)}</p>
								{f.href && (
									<Link href={f.href} className="label-mono mt-auto pt-2 underline underline-offset-4">
										{f.kind === "review" ? "Review →" : "See →"}
									</Link>
								)}
							</div>
						))}
					</div>
				</>
			)}
		</HomeCard>
	);
}
