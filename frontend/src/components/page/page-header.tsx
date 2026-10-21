import type { ReactNode } from "react";

// Every Phase 5 page opens the same way (spec 2026-10-22 §3): title and quiet actions on one row, the serif brief
// under it, then an optional control row. md:pr-12 leaves room for the floating account menu (app-shell.tsx).
export function PageHeader({
	title,
	brief,
	actions,
	children,
}: {
	title: ReactNode;
	brief?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="mb-5">
			<div className="flex flex-wrap items-center gap-3 md:pr-12">
				<h1 className="text-[26px] font-medium tracking-tight">{title}</h1>
				{actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
			</div>
			{brief && <div className="mt-1.5">{brief}</div>}
			{children && <div className="mt-4">{children}</div>}
		</header>
	);
}
