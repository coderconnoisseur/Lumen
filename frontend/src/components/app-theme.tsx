"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { THEME_COLOR, THEME_COOKIE, type AppTheme } from "@/lib/app-theme";

const Ctx = createContext<{ theme: AppTheme; setTheme: (t: AppTheme) => void }>({ theme: "sky", setTheme: () => {} });
export const useAppTheme = () => useContext(Ctx);

// Holds the chosen theme for the signed-in app. The data-app-theme attribute switches every token (globals.css,
// night.css); the context switches the icon set and the hero figures (icons.tsx, page/figure.tsx).
export function AppThemeProvider({ initial, children }: { initial: AppTheme; children: ReactNode }) {
	const [theme, set] = useState(initial);
	const setTheme = useCallback((t: AppTheme) => {
		set(t);
		document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
		document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[t]);
		document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", t === "night" ? "dark" : "light");
	}, []);
	return (
		<Ctx.Provider value={{ theme, setTheme }}>
			<div data-app-theme={theme} className="contents">
				{children}
			</div>
		</Ctx.Provider>
	);
}
