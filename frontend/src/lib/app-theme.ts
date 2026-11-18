// Which theme the signed-in app draws: Sky (light) or Night (dark). The user picks it in the account menu and a cookie
// remembers it, so the server paints the right one first. NEXT_PUBLIC_APP_THEME only sets the default for new visitors.
export type AppTheme = "sky" | "night";
export const THEME_COOKIE = "app_theme";
export const DEFAULT_THEME: AppTheme = process.env.NEXT_PUBLIC_APP_THEME === "night" ? "night" : "sky";
export const parseTheme = (v: string | undefined): AppTheme => (v === "night" || v === "sky" ? v : DEFAULT_THEME);
export const THEME_COLOR: Record<AppTheme, string> = { sky: "#f4f3ef", night: "#0b0b0c" };
