import type { Metadata } from "next";
import ReviewContent from "./reviewContent";

export const metadata: Metadata = { title: "Review" };

export default function Page() {
	return <ReviewContent />;
}
