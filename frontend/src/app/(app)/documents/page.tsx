import type { Metadata } from "next";
import DocumentsContent from "./documentsContent";

export const metadata: Metadata = { title: "Documents" };

export default function Page() {
	return <DocumentsContent />;
}
