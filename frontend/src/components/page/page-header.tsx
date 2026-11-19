import { HeaderControls } from "@/components/header-controls";
import type { ReactNode } from "react";

// Every Phase 5 page opens the same way (spec 2026-10-22 §3): title and quiet actions on one row, the serif brief
// under it, then an optional control row. On desktop the row ends with the dark mode switch and account menu, lined up with
// the page's actions (app-shell.tsx hides its floating copy wherever a PageHeader is).
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
		<header data-page-header className="mb-5">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="text-[26px] font-medium tracking-tight dark:font-display dark:text-[34px] dark:leading-[1.1] dark:font-light dark:tracking-[-0.01em]">{title}</h1>
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					{actions}
					<HeaderControls className="max-md:hidden" />
				</div>
			</div>
			{brief && <div className="mt-1.5">{brief}</div>}
			{children && <div className="mt-4">{children}</div>}
		</header>
	);
}
