import type { ReactNode } from "react";

// Re-mounted on every navigation (unlike layout.tsx), so the new page's content fades in briefly.
export default function AppTemplate({ children }: { children: ReactNode }) {
	return <div className="app-page-in flex flex-1 flex-col">{children}</div>;
}
