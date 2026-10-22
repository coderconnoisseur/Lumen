import type { Metadata } from "next";
import BillsContent from "./bills-content";

export const metadata: Metadata = { title: "Bills & subscriptions" };

export default function Page() {
	return <BillsContent />;
}
