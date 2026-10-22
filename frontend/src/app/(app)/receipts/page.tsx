import type { Metadata } from "next";
import ReceiptsContent from "./receipts-content";

export const metadata: Metadata = { title: "Receipts & statements" };

export default function Page() {
	return <ReceiptsContent />;
}
