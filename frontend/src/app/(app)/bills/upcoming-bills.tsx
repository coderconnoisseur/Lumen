"use client";

import { useEffect, useState } from "react";
import { aiAnalyticsApi } from "@/lib/api/client";
import { BillsCard } from "../home/_components/bills-card";
import { toReminders, type Reminder } from "../home/use-home-data";

// Interim Bills (until UI revamp Phase 5c): the same upcoming-bills list as Home, over the next two months.
export function UpcomingBills() {
	const [reminders, setReminders] = useState<Reminder[] | null>(null);
	useEffect(() => {
		aiAnalyticsApi.getReminders(62).then(
			(r: { reminders?: Parameters<typeof toReminders>[0] }) => setReminders(toReminders(r.reminders ?? [])),
			() => setReminders([]),
		);
	}, []);
	const today = new Date();
	return <BillsCard reminders={reminders ?? []} today={new Date(today.getFullYear(), today.getMonth(), today.getDate())} loading={reminders === null} />;
}
