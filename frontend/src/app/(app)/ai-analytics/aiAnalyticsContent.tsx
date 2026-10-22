"use client";

import { useState, useEffect } from "react";
import { DashboardShell } from "@/components/dashboard-shell";
import QuickStatsCard from "@/components/ai-analytics/quickStatsCard";
import AnomalyDetectionCard from "@/components/ai-analytics/anomalyDetectionCard";
import AISuggestionsCard from "@/components/ai-analytics/aiSuggestionsCard";
import CategoryPieChart from "@/components/ai-analytics/categoryPieChart";
import { aiAnalyticsApi } from "@/lib/api/client";

import { logger } from "@/lib/logger";
import { Badge } from "@/components/ui/badge";

export default function AIAnalyticsContent() {
	const [analysisTriggered, setAnalysisTriggered] = useState(false);

	useEffect(() => {
		const triggerAnalysis = async () => {
			if (analysisTriggered) return;

			try {
				logger.debug("Triggering AI analysis...");
				const data = await aiAnalyticsApi.runAnalysis({
					includeFraud: true,
					includeForecast: true,
					includeRisk: true,
					useLlm: false,
				});
				logger.debug("AI Analysis complete:", data);
				setAnalysisTriggered(true);
			} catch (error) {
				console.error("Error triggering analysis:", error);
			}
		};

		void triggerAnalysis();
	}, [analysisTriggered]);

	return (
		<DashboardShell
			title="AI Analytics"
			description="Surface risk, reminders, anomaly detection, and forward-looking spend signals without leaving the core finance workflow."
			eyebrow="AI Insights"
			actions={
				<Badge
					variant="outline"
					className="rounded-full border-border/70 bg-background/60 px-3 py-1 text-sm text-muted-foreground"
				>
					{analysisTriggered ? "Model refreshed" : "Analyzing live data..."}
				</Badge>
			}
		>
			{/* The payment calendar, reminders and spending-trend cards read fields the backend never sent; they were
			    removed (owner, 2026-10-22). Bills gets a real calendar in UI revamp Phase 5c, Spending a rebuild in 5b. */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
				<QuickStatsCard />
				<AnomalyDetectionCard />
				<CategoryPieChart />
				<div className="lg:col-span-3">
					<AISuggestionsCard />
				</div>
			</div>
		</DashboardShell>
	);
}
