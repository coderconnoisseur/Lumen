// Main-currency guess for onboarding (SPEC-ONBOARD): region of the browser's language → currency. Always editable.
const BY_REGION: Record<string, string> = {
	IN: "INR", US: "USD", GB: "GBP", CH: "CHF", JP: "JPY", CA: "CAD", AU: "AUD", NZ: "NZD", SG: "SGD", AE: "AED",
	CN: "CNY", HK: "HKD", ZA: "ZAR", BR: "BRL", MX: "MXN", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN",
	DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", AT: "EUR", BE: "EUR", PT: "EUR", FI: "EUR",
};

export function guessCurrency(locale: string): string {
	try {
		return BY_REGION[new Intl.Locale(locale).maximize().region ?? ""] ?? "USD";
	} catch {
		return "USD";
	}
}

export const CURRENCIES: string[] = Intl.supportedValuesOf("currency");

/** "INR · Indian Rupee", in the reader's language. */
export function currencyLabel(code: string): string {
	try {
		return `${code} · ${new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code}`;
	} catch {
		return code;
	}
}
