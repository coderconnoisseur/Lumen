import type { Metadata } from "next";
import { Suspense } from "react";
import BudgetContent from "./budget-content";

export const metadata: Metadata = { title: "Budget" };

// useSearchParams (?draft=1) needs a Suspense boundary for the static build
export default function Page() {
	return (
		<Suspense>
			<BudgetContent />
		</Suspense>
	);
}
