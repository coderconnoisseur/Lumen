import { useCallback } from "react";
import { useProfile } from "@/components/profile/profile-provider";

/** Money in the reader's language (SPEC-ONBOARD). Pick one decimal style per call site: never mix 0 and 2. */
export function formatMoney(amount: number, currency?: string | null, opts: { decimals?: 0 | 2 } = {}): string {
	const d = opts.decimals ?? 0;
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: currency || "INR",
			minimumFractionDigits: d,
			maximumFractionDigits: d,
		}).format(amount);
	} catch {
		return `${currency ?? ""} ${amount.toFixed(d)}`.trim(); // an unknown code stored on an old invoice
	}
}

/** The signed-in user's currency unless the amount has its own (a transaction's stored currency).
 *  ponytail: no exchange rates; totals assume the profile currency (SPEC-ONBOARD). */
export function useMoney() {
	const { profile } = useProfile();
	return useCallback(
		(amount: number, currency?: string | null, opts?: { decimals?: 0 | 2 }) =>
			formatMoney(amount, currency || profile?.currency, opts),
		[profile?.currency]
	);
}
