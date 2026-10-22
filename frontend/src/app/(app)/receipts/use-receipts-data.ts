"use client";

import { useCallback, useEffect, useState } from "react";
import { documentsApi, emailConfigApi, reviewApi, statementApi, transactionApi, type LumenDocument, type ReviewItem, type StatementImport } from "@/lib/api/client";
import { eventBus, EVENTS } from "@/lib/events";
import type { Txn } from "@/lib/home-math";

export type EmailStatus = {
	configured: boolean;
	email_address?: string;
	provider?: string;
	polling_enabled?: boolean;
	transactions_added?: number;
	last_successful_poll?: string | null;
	last_error?: string | null;
};

type Data = { review: ReviewItem[]; documents: LumenDocument[]; receipts: Txn[]; imports: StatementImport[]; email: EmailStatus | null };
const value = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === "fulfilled" ? r.value : fallback);

// Everything the Receipts & statements page shows, loaded together so the page appears in one step (no layout shift
// from the review row arriving late). A failed call empties only its own part. Uploads elsewhere refresh it.
// ponytail: the library lists the latest 100 receipts (statement lines left out server-side); page through
// /transactions if people need older ones here.
export function useReceiptsData() {
	const [data, setData] = useState<Data | null>(null);

	const load = useCallback(async () => {
		const [review, documents, txns, imports, email] = await Promise.allSettled([
			reviewApi.list(),
			documentsApi.list(),
			transactionApi.getTransactions({ page: 1, page_size: 100, exclude_source: "statement" }),
			statementApi.imports(),
			emailConfigApi.getStatus() as Promise<EmailStatus>,
		]);
		const rows = (value(txns, { data: [] }) as { data?: Txn[] }).data ?? [];
		setData({
			review: value(review, []) ?? [],
			documents: value(documents, []) ?? [],
			receipts: rows,
			imports: value(imports, []) ?? [],
			email: value(email, null),
		});
	}, []);

	useEffect(() => {
		void load();
		return eventBus.on(EVENTS.INVOICE_UPDATED, () => void load());
	}, [load]);

	const update = useCallback((change: (d: Data) => Partial<Data>) => setData((d) => (d ? { ...d, ...change(d) } : d)), []);
	return { data, reload: load, update };
}
