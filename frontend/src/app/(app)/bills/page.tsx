import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import PaymentCalendarCard from "@/components/ai-analytics/paymentCalendarCard";
import ReminderDetailsCard from "@/components/ai-analytics/reminderDetailsCard";

export const metadata: Metadata = { title: "Bills & subscriptions" };

// Interim (UI revamp Phase 1): the payment calendar and reminders until Phase 5 redesigns Bills.
export default function Page() {
	return (
		<DashboardShell title="Bills & subscriptions" eyebrow="Track">
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<PaymentCalendarCard />
				<ReminderDetailsCard />
			</div>
		</DashboardShell>
	);
}
