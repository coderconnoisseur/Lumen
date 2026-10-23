"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageCard } from "@/components/page/page-card";
import { PageHeader } from "@/components/page/page-header";
import { VendorChip } from "@/components/page/vendor-chip";
import { billsApi, type RecurringItem, type RecurringState } from "@/lib/api/client";
import { billsOnCalendar, dateTag, nextBillSentence, tiles, upcoming } from "@/lib/bills-math";
import { useMoney } from "@/lib/format";
import { parseDay } from "@/lib/home-math";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Brief } from "../home/_components/brief";

type Tab = "subscriptions" | "bills" | "all";
const TAB_LABEL: Record<Tab, string> = { all: "All", subscriptions: "Subscriptions", bills: "Bills" };
const monthYear = (y: number, m: number) => new Date(y, m, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
const dayMonth = (s: string) => parseDay(s).toLocaleString("en-GB", { day: "numeric", month: "short" });
const isSubscription = (i: RecurringItem) => i.kind === "subscription";

// Bills & subscriptions (UI revamp Phase 5c, spec 2026-10-22 §4.3): what's due, what recurs, what can I cut?
// Everything comes from GET /api/bills/recurring; the user's "cancelled" / "not a bill" choices are saved there.
export default function BillsContent() {
	const money = useMoney();
	const today = useMemo(() => {
		const n = new Date();
		return new Date(n.getFullYear(), n.getMonth(), n.getDate());
	}, []);
	const [data, setData] = useState<RecurringState | null>(null);
	const [shown, setShown] = useState({ y: today.getFullYear(), m: today.getMonth() });
	const [tab, setTab] = useState<Tab>("all");
	const [showHidden, setShowHidden] = useState(false);

	useEffect(() => {
		billsApi.recurring().then(setData, () => setData({ items: [], hidden: [] }));
	}, []);

	async function choose(vendor: string, state: "cancelled" | "not_a_bill" | "active") {
		try {
			setData(await billsApi.setState(vendor, state));
		} catch {
			toast.error("Couldn't save that. Try again.");
		}
	}

	const loading = data === null;
	const items = data?.items ?? [];
	const t = tiles(items, today);
	const groups = upcoming(items, today);
	const brief = loading
		? null
		: items.length === 0
			? "Lumen hasn't spotted any regular payments yet. They show up here after three similar charges."
			: [
					nextBillSentence(groups, today, money),
					t.stopped.count > 0 &&
						`${t.stopped.count} ${t.stopped.count === 1 ? "subscription looks" : "subscriptions look"} stopped, about ${money(t.stopped.perMonth)} a month.`,
				]
					.filter(Boolean)
					.join(" ") || `${money(t.perMonth)} goes out every month in regular payments.`;

	const listed = items.filter((i) => i.state !== "cancelled");
	const counts = { subscriptions: listed.filter(isSubscription).length, bills: listed.filter((i) => !isSubscription(i)).length, all: listed.length };
	const rows = listed.filter((i) => tab === "all" || (tab === "subscriptions") === isSubscription(i));
	const cancelled = items.filter((i) => i.state === "cancelled");

	const step = (d: number) => setShown(({ y, m }) => ({ y: new Date(y, m + d, 1).getFullYear(), m: new Date(y, m + d, 1).getMonth() }));
	const monthSwitcher = (
		<div className="flex items-center rounded-[9px] border border-border/70 bg-card/70">
			<button type="button" aria-label="Previous month" onClick={() => step(-1)} className="p-1.5 text-muted-foreground hover:text-foreground">
				<ChevronLeft className="size-4" />
			</button>
			<span className="label-ui w-32 text-center text-foreground">{monthYear(shown.y, shown.m)}</span>
			<button type="button" aria-label="Next month" onClick={() => step(1)} className="p-1.5 text-muted-foreground hover:text-foreground">
				<ChevronRight className="size-4" />
			</button>
		</div>
	);

	return (
		<div className="relative flex-1">
			<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[image:var(--band)]" />
			<div className="relative px-4 py-6 sm:px-6 lg:px-8">
				<PageHeader title="Bills & subscriptions" brief={<Brief text={brief} />} actions={monthSwitcher} />

				<div className="grid gap-3.5 sm:grid-cols-3">
					<PageCard title="Due in the next 30 days" loading={loading} skeletonHeight={56} data-testid="tile-due">
						<div className="text-[26px] leading-tight font-medium tracking-tight tabular-nums">{money(t.dueSoon.total)}</div>
						<p className="mt-1 text-[12.5px] text-muted-foreground">
							{t.dueSoon.count} {t.dueSoon.count === 1 ? "bill" : "bills"}
						</p>
					</PageCard>
					<PageCard title="Recurring every month" loading={loading} skeletonHeight={56} data-testid="tile-monthly">
						<div className="text-[26px] leading-tight font-medium tracking-tight tabular-nums">{money(t.perMonth)}</div>
						<p className="mt-1 text-[12.5px] text-muted-foreground">Yearly and weekly ones spread per month</p>
					</PageCard>
					<PageCard title="Subscriptions that look stopped" loading={loading} skeletonHeight={56} data-testid="tile-stopped">
						<div className="text-[26px] leading-tight font-medium tracking-tight tabular-nums">
							{money(t.stopped.perMonth)} <span className="text-[13px] font-normal tracking-normal text-muted-foreground">a month</span>
						</div>
						<p className="mt-1 truncate text-[12.5px] text-muted-foreground">
							{t.stopped.count === 0
								? "None right now"
								: items.filter((i) => i.possibly_stopped && isSubscription(i) && i.state !== "cancelled").map((i) => i.vendor).join(", ")}
						</p>
					</PageCard>
				</div>

				<div className="mt-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]">
					<BillCalendar items={items} year={shown.y} month={shown.m} today={today} loading={loading} />
					<PageCard title="Upcoming" extra={<span className="text-[12.5px] text-muted-foreground">Next 30 days</span>} loading={loading} skeletonHeight={420} data-testid="upcoming">
						{groups.length === 0 ? (
							<p className="text-sm text-muted-foreground">Nothing due in the next 30 days.</p>
						) : (
							groups.map((g) => (
								<div key={g.label} className="mb-3 last:mb-0">
									<div className="label-ui mb-1 flex text-muted-foreground">
										{g.label}
										<span className="ml-auto tabular-nums">{money(g.total)}</span>
									</div>
									{g.rows.map((r) => (
										<div key={`${r.vendor}-${r.date.getTime()}`} className="flex items-center gap-3 border-b border-border/60 py-2 text-[13.5px] last:border-0">
											<span className="w-[38px] shrink-0 rounded-[9px] border border-border py-1 text-center leading-tight">
												<span className="block text-[10px] text-muted-foreground uppercase">{dateTag(r.date, today)}</span>
												<b className="block text-[14px] font-medium">{r.date.getDate()}</b>
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate">{r.vendor}</span>
												<span className="block text-[11.5px] text-muted-foreground capitalize">{r.item.cadence}</span>
											</span>
											<span className="shrink-0 font-medium tabular-nums">{money(r.amount)}</span>
										</div>
									))}
								</div>
							))
						)}
					</PageCard>
				</div>

				<PageCard
					title="Regular payments"
					extra={
						<div role="tablist" className="ml-2 flex gap-0.5 rounded-[9px] border border-border/60 p-0.5">
							{(["all", "subscriptions", "bills"] as Tab[]).map((k) => (
								<button
									key={k}
									type="button"
									role="tab"
									aria-selected={tab === k}
									onClick={() => setTab(k)}
									className={cn("rounded-[7px] px-2.5 py-0.5 text-[12px] whitespace-nowrap max-sm:px-1.5", tab === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
								>
									{TAB_LABEL[k]} {counts[k]}
								</button>
							))}
						</div>
					}
					loading={loading}
					skeletonHeight={240}
					className="mt-3.5"
					data-testid="recurring-table"
				>
					{rows.length === 0 ? (
						<p className="py-4 text-sm text-muted-foreground">Nothing here yet.</p>
					) : (
						rows.map((i) => <RecurringRow key={i.vendor} item={i} onChoose={choose} />)
					)}
					{cancelled.length > 0 && (
						<div data-testid="cancelled-group" className="mt-4 border-t border-border/60 pt-3">
							<div className="label-ui mb-1 text-muted-foreground">Cancelled</div>
							{cancelled.map((i) => (
								<div key={i.vendor} className="flex items-center gap-3 py-1.5 text-[13px] text-muted-foreground">
									<VendorChip name={i.vendor} className="opacity-60" />
									<span className="min-w-0 flex-1 truncate">{i.vendor}</span>
									<span className="tabular-nums">{money(i.typical_amount)}</span>
									<button type="button" aria-label={`Undo cancelling ${i.vendor}`} onClick={() => void choose(i.vendor, "active")} className="label-ui text-primary hover:underline">
										Undo
									</button>
								</div>
							))}
						</div>
					)}
					{(data?.hidden.length ?? 0) > 0 && (
						<div className="mt-3 border-t border-border/60 pt-3 text-[12.5px]">
							<button type="button" aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)} className="text-muted-foreground hover:text-foreground">
								Hidden ({data!.hidden.length})
							</button>
							{showHidden && (
								<div data-testid="hidden-list" className="mt-2">
									{data!.hidden.map((h) => (
										<div key={h.vendor_key} className="flex items-center gap-3 py-1 text-muted-foreground">
											<span className="flex-1">{h.vendor} · not a bill</span>
											<button type="button" aria-label={`Undo hiding ${h.vendor}`} onClick={() => void choose(h.vendor, "active")} className="label-ui text-primary hover:underline">
												Undo
											</button>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</PageCard>
			</div>
		</div>
	);
}

function RecurringRow({ item: i, onChoose }: { item: RecurringItem; onChoose: (vendor: string, state: "cancelled" | "not_a_bill") => void }) {
	const money = useMoney();
	return (
		<div data-testid="recurring-row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border/60 py-2.5 text-[13px] last:border-0 md:grid-cols-[minmax(0,1fr)_90px_90px_100px_auto]">
			<span className="flex min-w-0 items-center gap-2.5">
				<VendorChip name={i.vendor} />
				<span className="min-w-0">
					<span className="flex flex-wrap items-center gap-1.5">
						<span className="truncate font-medium">{i.vendor}</span>
						{i.price_change && (
							<span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700">
								{money(i.price_change.previous)} → {money(i.price_change.latest)}
							</span>
						)}
						{i.possibly_stopped && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">looks stopped</span>}
						{i.state === "charged_again" && (
							<span className="rounded-full bg-bad/10 px-2 py-0.5 text-[11px] text-bad">charged again after you cancelled</span>
						)}
					</span>
					<span className="block text-[11.5px] text-muted-foreground capitalize">
						{i.cadence} · {i.kind === "subscription" ? "subscription" : "bill"}
					</span>
				</span>
			</span>
			<span className="hidden text-muted-foreground md:block">{dayMonth(i.last_charge_date)}</span>
			<span className="hidden text-muted-foreground md:block">{i.possibly_stopped ? "—" : dayMonth(i.next_due_date)}</span>
			<span className="text-right font-medium tabular-nums">
				{money(i.typical_amount)}
				<span className="block text-[11px] font-normal text-muted-foreground">a {i.cadence === "weekly" ? "week" : i.cadence === "yearly" ? "year" : "month"}</span>
			</span>
			<span className="col-span-2 flex flex-wrap justify-end gap-3 text-[12px] md:col-span-1">
				<button type="button" aria-label={`Mark ${i.vendor} as cancelled`} onClick={() => onChoose(i.vendor, "cancelled")} className="text-muted-foreground hover:text-foreground">
					Mark as cancelled
				</button>
				<button type="button" aria-label={`Mark ${i.vendor} as not a bill`} onClick={() => onChoose(i.vendor, "not_a_bill")} className="text-muted-foreground hover:text-foreground">
					Not a bill
				</button>
				<Link href={`/ask?draft=${encodeURIComponent(`How do I cancel ${i.vendor}?`)}`} aria-label={`How to cancel ${i.vendor}`} className="text-primary hover:underline">
					How to cancel
				</Link>
			</span>
		</div>
	);
}

// The shown month, Monday first and always six rows tall (no jump between months), with each bill on its due days.
function BillCalendar({ items, year, month, today, loading }: { items: RecurringItem[]; year: number; month: number; today: Date; loading: boolean }) {
	const money = useMoney();
	const lead = (new Date(year, month, 1).getDay() + 6) % 7;
	const days = new Date(year, month + 1, 0).getDate();
	const byDay = billsOnCalendar(items, year, month);
	const isToday = (d: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
	return (
		<PageCard title={`${monthYear(year, month)}, bill by bill`} loading={loading} skeletonHeight={420} data-testid="bill-calendar">
			<div className="grid grid-cols-7 gap-1">
				{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
					<div key={i} className="pb-0.5 text-center text-[10.5px] text-muted-foreground/70">
						{d}
					</div>
				))}
				{Array.from({ length: 42 }, (_, cell) => {
					const d = cell - lead + 1;
					if (d < 1 || d > days) return <div key={cell} className="h-[62px]" />;
					const bills = byDay.get(d) ?? [];
					return (
						<div
							key={cell}
							data-testid={`bill-day-${d}`}
							className={cn(
								"flex h-[62px] flex-col gap-0.5 overflow-hidden rounded-[7px] border border-border/60 px-1.5 py-1 text-[10.5px] leading-tight text-muted-foreground",
								isToday(d) && "outline-[1.5px] outline-primary outline-solid -outline-offset-1",
							)}
						>
							{d}
							{bills.slice(0, 1).map((b) => (
								<span key={b.vendor} className="truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] text-foreground/80" title={`${b.vendor} · ${money(b.typical_amount)}`}>
									{b.vendor}
								</span>
							))}
							{bills.length > 1 && <span className="text-[10px]">+{bills.length - 1} more</span>}
						</div>
					);
				})}
			</div>
		</PageCard>
	);
}
