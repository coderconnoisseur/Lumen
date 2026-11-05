// Which theme the signed-in app draws. Night is local-only for now: production never sets the variable, so it stays on Sky.
export const APP_THEME = process.env.NEXT_PUBLIC_APP_THEME === "night" ? "night" : "sky";
