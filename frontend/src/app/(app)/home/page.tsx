import type { Metadata } from "next";
import HomeContent from "./homeContent";

export const metadata: Metadata = { title: "Home" };

export default function Page() {
	return <HomeContent />;
}
