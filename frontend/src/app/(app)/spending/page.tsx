import type { Metadata } from "next";
import SpendingContent from "./spending-content";

export const metadata: Metadata = { title: "Spending" };

export default function Page() {
	return <SpendingContent />;
}
