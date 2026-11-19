"use client";

import { useAppTheme } from "@/components/app-theme";
import { Figure as NightFigure } from "./figure.night";
import { Figure as SkyFigure } from "./figure.sky";

// A hero total: Sky counts up once (figure.sky.tsx), Night rolls the digits on every change (figure.night.tsx).
export function Figure(props: { value: number; format: (n: number) => string }) {
	return useAppTheme().theme === "night" ? <NightFigure {...props} /> : <SkyFigure {...props} />;
}
