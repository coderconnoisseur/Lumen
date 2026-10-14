import type { Metadata } from "next";
import AnalyticsContent from "./analyticsContent";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
	return <AnalyticsContent />;
}
