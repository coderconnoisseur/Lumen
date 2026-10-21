"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProfile } from "@/components/profile/profile-provider";
import { DialogDemo } from "@/components/uploadDialog";
import { ExportDialog } from "@/components/exportDialog";
import type { FoundItem } from "@/lib/api/client";
import { useMoney } from "@/lib/format";
import { briefSentence, cumulative, dayIndex, fill, parseDay, periods, sameDayDelta, type Range } from "@/lib/home-math";
import { PageHeader } from "@/components/page/page-header";
import { Brief } from "./_components/brief";
import { ActivityCard } from "./_components/activity-card";
import { BillsCard } from "./_components/bills-card";
import { BudgetCard, DraftBudgetPromo } from "./_components/budget-card";
import { CalendarCard } from "./_components/calendar-card";
import { LumenFound } from "./_components/lumen-found";
import { SpendCard } from "./_components/spend-card";
import { useHomeData, type Reminder } from "./use-home-data";

const partOfDay = (h: number) => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");
const monthName = (d: Date) => d.toLocaleString("en-IN", { month: "long" });

// The brief's second sentence: the top "Lumen found" item, if there is one.
function worthALook(item: FoundItem | undefined, money: (n: number) => string) {
	return item ? ` The one thing worth a look: ${fill(item.headline, item.amounts, money).replace(/\.$/, "")}.` : "";
}

export function nextBill(reminders: Reminder[], today: Date) {
	return reminders
		.filter((r) => r.type === "upcoming" && parseDay(r.date) >= today)
		.sort((a, b) => a.date.localeCompare(b.date))[0];
}

// Home (UI revamp spec §4): brief, then the money cards. Data is today's endpoints; see use-home-data.ts.
export default function HomeContent() {
	const openUpload = useSearchParams().get("upload") === "1";
	const { profile } = useProfile();
	const money = useMoney();
	const [range, setRange] = useState<Range>("1M");
	const today = useMemo(() => {
		const n = new Date();
		return new Date(n.getFullYear(), n.getMonth(), n.getDate());
	}, []);
	const data = useHomeData(range, today);

	const month = periods("1M", today);
	const monthCur = cumulative(data.monthTxns, month.current);
	const monthPrev = cumulative(data.prevMonthTxns, month.previous);
	const todayIdx = dayIndex(month.current, today);
	const bill = nextBill(data.reminders, today);
	const brief =
		data.status === "loading"
			? null
			: briefSentence({
					monthName: monthName(today),
					prevMonthName: monthName(month.previous.start),
					spent: monthCur[todayIdx] ?? 0,
					delta: sameDayDelta(monthCur, monthPrev, todayIdx),
					nextBill: bill ? { vendor: bill.vendor, date: parseDay(bill.date) } : undefined,
					money: (n) => money(n),
					today,
				}) + worthALook(data.summary?.found[0], money);

	const firstName = profile?.display_name?.split(" ")[0];
	const chart = periods(range, today);

	return (
		<div className="relative flex-1">
			<div aria-hidden data-testid="sky-band" className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[image:var(--band)]" />
			<div className="relative px-4 py-6 sm:px-6 lg:px-8">
				<PageHeader
					title={firstName ? `Good ${partOfDay(new Date().getHours())}, ${firstName}` : "Welcome back"}
					brief={<Brief text={brief} />}
					actions={
						<>
							<ExportDialog />
							<DialogDemo defaultOpen={openUpload} />
						</>
					}
				/>
				<div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_330px]">
					<div className="flex min-w-0 flex-col gap-3.5" data-testid="home-main">
						<SpendCard
							range={range}
							onRange={setRange}
							period={chart.current}
							previous={chart.previous}
							cur={cumulative(data.txns, chart.current)}
							prev={cumulative(data.prevTxns, chart.previous)}
							forecast={data.forecast}
							reminders={data.reminders}
							today={today}
							loading={data.status === "loading"}
						/>
						<LumenFound summary={data.summary} loading={data.status === "loading"} />
						<CalendarCard txns={data.monthTxns} period={month.current} loading={data.status === "loading"} />
					</div>
					<div className="flex min-w-0 flex-col gap-3.5" data-testid="home-side">
						<BudgetCard budget={data.budget} monthName={monthName(today)} today={today} loading={data.status === "loading"} />
						<BillsCard reminders={data.reminders} today={today} loading={data.status === "loading"} />
						{/* once you have category budgets, the promo has done its job */}
						{!data.budget?.categories.length && <DraftBudgetPromo onChanged={data.reload} />}
						<ActivityCard items={data.summary?.activity ?? []} now={new Date()} loading={data.status === "loading"} />
					</div>
				</div>
			</div>
		</div>
	);
}
