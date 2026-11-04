"use client";

import NumberFlow from "@number-flow/react";
import { useProfile } from "@/components/profile/profile-provider";

// Night's hero total: the digits roll to each new value, so switching range shows what changed. NumberFlow does the
// rolling and honours reduced motion itself.
export function Figure({ value, format }: { value: number; format: (n: number) => string }) {
	const { profile } = useProfile();
	const currency = profile?.currency || "INR";
	try {
		new Intl.NumberFormat(undefined, { style: "currency", currency });
	} catch {
		return <>{format(value)}</>; // an unknown code stored on an old profile
	}
	return <NumberFlow value={value} format={{ style: "currency", currency, maximumFractionDigits: 0 }} />;
}

export const Amount = Figure;
