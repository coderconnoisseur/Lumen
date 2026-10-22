import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The card every Phase 5 page is built from (spec 2026-10-22 §3): a quiet title row (title, › when it links,
// `extra` such as a legend or pill, `action` on the right) and a skeleton at the card's final height while loading,
// so nothing shifts when the data arrives.
export function PageCard({
	title,
	href,
	extra,
	action,
	loading,
	skeletonHeight,
	className,
	children,
	...rest
}: {
	title: ReactNode;
	href?: string;
	extra?: ReactNode;
	action?: ReactNode;
	loading?: boolean;
	skeletonHeight: number;
	className?: string;
	children: ReactNode;
	"data-testid"?: string;
}) {
	return (
		<section
			{...rest}
			className={cn(
				"rounded-2xl border border-border/70 bg-card px-5 py-[18px] shadow-[0_1px_2px_rgba(28,28,26,.04),0_4px_16px_-8px_rgba(28,28,26,.08)]",
				className,
			)}
		>
			<div className="label-ui mb-3 flex min-h-7 items-center gap-2 text-muted-foreground">
				{href ? (
					<Link href={href} className="hover:text-foreground">
						{title} <span aria-hidden>›</span>
					</Link>
				) : (
					<h2>{title}</h2>
				)}
				{extra}
				{action && <div className="ml-auto">{action}</div>}
			</div>
			{loading ? <Skeleton style={{ height: skeletonHeight }} /> : <div style={{ minHeight: skeletonHeight }}>{children}</div>}
		</section>
	);
}
