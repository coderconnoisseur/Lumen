import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import DocumentsContent from "../documents/documentsContent";
import ImportContent from "../import/importContent";
import ReviewContent from "../review/reviewContent";

export const metadata: Metadata = { title: "Receipts & statements" };

const TABS = [
	{ id: "documents", label: "Documents", Content: DocumentsContent },
	{ id: "import", label: "Import", Content: ImportContent },
	{ id: "review", label: "Review", Content: ReviewContent },
] as const;

// Interim (UI revamp Phase 1): the old Documents, Import and Review pages as tabs until Phase 5 redesigns this page.
export default function Page({ searchParams }: { searchParams: { tab?: string } }) {
	const active = TABS.find((t) => t.id === searchParams.tab) ?? TABS[0];
	return (
		<>
			<nav aria-label="Receipts & statements" className="flex gap-6 px-4 pt-6 sm:px-6 lg:px-8">
				{TABS.map((t) => (
					<Link
						key={t.id}
						href={`?tab=${t.id}`}
						aria-current={t.id === active.id ? "page" : undefined}
						className={cn(
							"label-mono border-b-2 pb-2 transition-colors",
							t.id === active.id
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{t.label}
					</Link>
				))}
			</nav>
			<active.Content />
		</>
	);
}
