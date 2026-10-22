"use client";

import { useEffect, useState } from "react";
import { billsApi } from "@/lib/api/client";
import { BillsCard } from "../home/_components/bills-card";
import { toBills, type Reminder } from "../home/use-home-data";

// Interim Bills (replaced in UI revamp Phase 5c Task C3): the same upcoming-bills list as Home.
export function UpcomingBills() {
	const [bills, setBills] = useState<Reminder[] | null>(null);
	const today = new Date();
	const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	useEffect(() => {
		billsApi.recurring().then((r) => setBills(toBills(r.items, day)), () => setBills([]));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return <BillsCard reminders={bills ?? []} today={day} loading={bills === null} />;
}
