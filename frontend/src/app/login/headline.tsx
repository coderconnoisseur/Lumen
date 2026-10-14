import type { ReactNode } from "react";

// The login page's sky line (same as the landing hero, for continuity). Shared by the page and its loading fallback,
// in a plain module so the server page gets the value itself, not a client reference.
export const LOGIN_HEADLINE: ReactNode[] = ["Meet the AI that", <><em>minds</em> your money.</>];
