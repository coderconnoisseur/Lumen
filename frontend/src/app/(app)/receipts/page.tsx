import type { Metadata } from "next";
import { ReceiptsTabs } from "./receipts-tabs";

export const metadata: Metadata = { title: "Receipts & statements" };

// Interim (UI revamp Phase 1): the old Documents, Import and Review pages as tabs until Phase 5 redesigns this page.
export default function Page() {
	return <ReceiptsTabs />;
}
