"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import DocumentsContent from "../documents/documentsContent";
import ImportContent from "../import/importContent";
import ReviewContent from "../review/reviewContent";

const TABS = [
	{ id: "documents", label: "Documents", Content: DocumentsContent },
	{ id: "import", label: "Import", Content: ImportContent },
	{ id: "review", label: "Review", Content: ReviewContent },
] as const;

// Reads ?tab= on the client so /receipts stays a static page (no server render per visit).
export function ReceiptsTabs() {
	const tab = useSearchParams().get("tab");
	const active = TABS.find((t) => t.id === tab) ?? TABS[0];
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
