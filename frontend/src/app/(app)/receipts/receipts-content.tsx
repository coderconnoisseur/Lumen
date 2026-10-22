"use client";

import Link from "next/link";
import { FileSpreadsheet, Mail } from "lucide-react";
import { PageHeader } from "@/components/page/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogDemo as UploadDialog } from "@/components/uploadDialog";
import { documentsApi } from "@/lib/api/client";
import { toast } from "@/lib/toast";
import { Brief } from "../home/_components/brief";
import { Library, toRows } from "./_components/library";
import { ReviewCards } from "./_components/review-cards";
import { ImportsCard, InboxCard } from "./_components/side-cards";
import { useReceiptsData } from "./use-receipts-data";

// Receipts & statements (UI revamp Phase 5e, spec 2026-10-22 §4.5): what have I given Lumen, and what needs my OK?
// Replaces the Documents / Import / Review tabs. Everything loads together and appears in one step, so the review
// row (only there when something is flagged) never pushes the rest down.
export default function ReceiptsContent() {
	const { data, reload, update } = useReceiptsData();

	async function remove(id: string) {
		try {
			await documentsApi.remove(id);
			update((d) => ({ documents: d.documents.filter((x) => x.id !== id) }));
		} catch {
			toast.error("Couldn't delete that document.");
		}
	}

	const n = data?.review.length ?? 0;
	const rows = data ? toRows(data, (id) => void remove(id)) : [];
	// with the review queue unknown, say only what is known
	const brief = !data ? null : data.reviewFailed ? `${rows.length} ${rows.length === 1 ? "file" : "files"} with Lumen.` : n ? `${n} ${n === 1 ? "receipt needs" : "receipts need"} your OK before ${n === 1 ? "it counts" : "they count"}.` : "Everything you've given Lumen is filed.";

	return (
		<div className="relative flex-1">
			<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[image:var(--band)]" />
			<div className="relative px-4 py-6 sm:px-6 lg:px-8">
				<PageHeader
					title="Receipts & statements"
					brief={<Brief text={brief} />}
					actions={
						<>
							<UploadDialog />
							<Button asChild variant="quiet">
								<Link href="/receipts/import">
									<FileSpreadsheet /> Import statement
								</Link>
							</Button>
							{data && !data.email?.configured && (
								<Button asChild variant="quiet">
									<a href="#inbox">
										<Mail /> Connect email
									</a>
								</Button>
							)}
						</>
					}
				/>
				{!data ? (
					<Skeleton className="h-[640px] w-full rounded-2xl" />
				) : (
					<>
						{n > 0 && (
							<div className="mb-3.5">
								<ReviewCards items={data.review} onDecided={(id) => update((d) => ({ review: d.review.filter((r) => r.id !== id) }))} />
							</div>
						)}
						<div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]">
							<Library rows={rows} />
							<div id="inbox" className="flex scroll-mt-6 flex-col gap-3.5">
								<ImportsCard imports={data.imports} />
								<InboxCard email={data.email} onChanged={() => void reload()} />
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
