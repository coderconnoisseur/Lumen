import type { Metadata } from "next";
import AIAnalyticsContent from "./aiAnalyticsContent";

export const metadata: Metadata = { title: "AI insights" };

export default function Page() {
	return <AIAnalyticsContent />;
}
