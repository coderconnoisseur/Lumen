import type { Metadata } from "next";
import ImportContent from "./import-content";

export const metadata: Metadata = { title: "Import a statement" };

export default function Page() {
	return <ImportContent />;
}
