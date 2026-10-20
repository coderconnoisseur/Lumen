import type { Metadata } from "next";
import AnalyticsContent from "../analytics/analyticsContent";
import AIAnalyticsContent from "../ai-analytics/aiAnalyticsContent";

export const metadata: Metadata = { title: "Spending" };

// Interim (UI revamp Phase 1): the old Analytics and AI Insights pages stacked until Phase 5 redesigns Spending.
export default function Page() {
	return (
		<>
			<AnalyticsContent />
			<AIAnalyticsContent />
		</>
	);
}
