import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import { UpcomingBills } from "./upcoming-bills";

export const metadata: Metadata = { title: "Bills & subscriptions" };

// Interim until UI revamp Phase 5c redesigns Bills: the upcoming bills Lumen has spotted.
export default function Page() {
	return (
		<DashboardShell title="Bills & subscriptions" eyebrow="Track">
			<div className="max-w-xl">
				<UpcomingBills />
			</div>
		</DashboardShell>
	);
}
