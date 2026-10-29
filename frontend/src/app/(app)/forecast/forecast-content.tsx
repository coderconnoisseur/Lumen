"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageCard } from "@/components/page/page-card";
import { PageHeader } from "@/components/page/page-header";
import { forecastApi, type ForecastData } from "@/lib/api/client";
import { accuracyLabel, headline, monthOf } from "@/lib/forecast-math";
import { useMoney } from "@/lib/format";
import { Brief } from "../home/_components/brief";
import { ForecastCategories } from "./_components/categories";
import { ForecastHero } from "./_components/hero";
import { HowItWorks } from "./_components/how";
import { ForecastMonths } from "./_components/months";
import { WhatIf } from "./_components/what-if";

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type State = { status: "loading" } | { status: "error" } | { status: "ready"; data: ForecastData | null };

// Plan · Forecast (spec 2026-10-28 §4): where this month lands, the next three, and why. One forecast for the whole
// app (GET /api/forecast): Home's "heading for", Budget's bar and Ask Lumen read the same numbers.
export default function ForecastContent() {
	const money = useMoney();
	const today = useMemo(() => new Date(), []);
	const [state, setState] = useState<State>({ status: "loading" });
	const load = useCallback(() => {
		forecastApi.get(isoDay(today)).then(
			(data) => setState({ status: "ready", data }),
			() => setState({ status: "error" }),
		);
	}, [today]);
	useEffect(load, [load]);

	const loading = state.status === "loading";
	const data = state.status === "ready" ? state.data : null;
	const m0 = data?.months[0];
	const h = m0 && headline(m0, monthOf(m0.month));
	const brief = loading ? null : h ? (
		<>
			{h.lead} <b className="font-medium text-foreground">{money(Math.round(h.amount))}</b>
			{h.verdict && (
				<>
					{" · "}
					<em data-testid="verdict" data-tone={h.verdict.over ? "bad" : "good"} className={h.verdict.over ? "text-bad" : "text-good"}>
						{money(Math.round(h.verdict.by))} {h.verdict.over ? "over" : "under"} budget
					</em>
				</>
			)}
		</>
	) : state.status === "error" ? "The forecast didn't load." : "Not enough history to forecast yet.";

	return (
		<div className="relative flex-1">
			<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[image:var(--band)]" />
			<div className="relative px-4 py-6 sm:px-6 lg:px-8">
				<PageHeader
					title="Forecast"
					brief={<Brief text={brief} />}
					actions={
						data && (
							<span data-testid="accuracy" className="label-ui rounded-full border border-border/70 bg-card/70 px-3 py-1 normal-case text-muted-foreground">
								{accuracyLabel(data.accuracy)}
							</span>
						)
					}
				/>
				{loading || data ? (
					<>
						<ForecastHero data={data} today={today} loading={loading} />
						<div className="mt-3.5">
							<ForecastMonths months={data?.months ?? []} loading={loading} onIncome={load} />
						</div>
						<div className="mt-3.5 grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
							<ForecastCategories month={m0} loading={loading} />
							<div className="grid gap-3.5">
								<WhatIf data={data} loading={loading} />
								<HowItWorks accuracy={data?.accuracy} loading={loading} />
							</div>
						</div>
					</>
				) : (
					<PageCard title="Forecast" skeletonHeight={64} data-testid="forecast-empty">
						<p className="text-[14px] text-foreground/80">
							{state.status === "error" ? (
								"Couldn't load the forecast. Try again in a moment."
							) : (
								<>
									Lumen needs about a month of spending before it can forecast.{" "}
									<Link href="/receipts/import" className="underline underline-offset-4">
										Import a statement
									</Link>
								</>
							)}
						</p>
					</PageCard>
				)}
			</div>
		</div>
	);
}
