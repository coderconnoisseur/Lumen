import type { Metadata } from "next";
import ImportContent from "./importContent";

export const metadata: Metadata = { title: "Import statement" };

export default function Page() {
	return <ImportContent />;
}
