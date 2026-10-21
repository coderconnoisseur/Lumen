import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Shared Home card: mono title row, and a skeleton at the card's final height while loading (no shift on arrival).
export function HomeCard({
	title,
	href,
	loading,
	skeletonHeight,
	className,
	action,
	children,
	...rest
}: {
	title: ReactNode;
	href?: string;
	loading?: boolean;
	skeletonHeight: number;
	className?: string;
	action?: ReactNode;
	children: ReactNode;
	"data-testid"?: string;
}) {
	return (
		<section {...rest} className={cn("rounded-[14px] border border-border bg-card px-4 py-3.5", className)}>
			<div className="label-ui mb-2.5 flex items-center text-muted-foreground">
				{href ? (
					<Link href={href} className="hover:text-foreground">
						{title} ›
					</Link>
				) : (
					<h2>{title}</h2>
				)}
				{action && <div className="ml-auto">{action}</div>}
			</div>
			{loading ? <Skeleton style={{ height: skeletonHeight }} /> : <div style={{ minHeight: skeletonHeight }}>{children}</div>}
		</section>
	);
}
