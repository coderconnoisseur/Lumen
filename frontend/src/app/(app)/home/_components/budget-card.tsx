import { HomeCard } from "./card";

// Budgets arrive in Phase 3 (model + an AI draft you approve line by line). Until then: an honest empty state.
export function BudgetCard({ monthName }: { monthName: string }) {
	return (
		<HomeCard title={`Budget · ${monthName}`} skeletonHeight={64}>
			<p className="text-[15px] font-medium">No budget yet</p>
			<p className="mt-1 text-[12.5px] text-muted-foreground">Lumen can draft one from your last 3 months.</p>
		</HomeCard>
	);
}

export function DraftBudgetPromo() {
	return (
		<section className="rounded-[14px] bg-accent-soft px-4 py-3.5">
			<h3 className="text-[15px] font-semibold">Let Lumen draft your budget</h3>
			<p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
				Built from 3 months of your actual spending. You approve every line before it&apos;s saved.
			</p>
			<button
				type="button"
				disabled
				aria-disabled
				className="label-mono mt-2.5 cursor-not-allowed rounded-full bg-foreground px-3.5 py-1.5 text-background opacity-60"
			>
				Coming soon
			</button>
		</section>
	);
}
