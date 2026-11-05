// A headline amount on the pages after Home: plain text here. A Night build swaps this file for amount.night.tsx at bundle
// time (see next.config.js), which rolls the digits. Its own file so these pages don't load Figure's animation library.
export function Amount({ value, format }: { value: number; format: (n: number) => string }) {
	return <>{format(value)}</>;
}
