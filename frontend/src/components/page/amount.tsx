"use client";

import { useAppTheme } from "@/components/app-theme";
import { Figure as NightFigure } from "./figure.night";

// A headline amount on the pages after Home: plain text in Sky, rolling digits in Night.
export function Amount(props: { value: number; format: (n: number) => string }) {
	return useAppTheme().theme === "night" ? <NightFigure {...props} /> : <>{props.format(props.value)}</>;
}
