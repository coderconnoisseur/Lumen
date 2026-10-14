import type { Metadata } from "next";
import DashboardContent from "./dashboardContent";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
	return <DashboardContent />;
}
