import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The signed-in app (old URLs redirect here in next.config.js before middleware runs).
const PROTECTED_PREFIXES = ["/home", "/spending", "/bills", "/receipts", "/ask", "/settings"];

export function middleware(request: NextRequest) {
	const { pathname, search } = request.nextUrl;
	const isProtected = PROTECTED_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
	);

	if (!isProtected) {
		return NextResponse.next();
	}

	const hasSession = request.cookies.get("lumen_session")?.value === "1";
	if (hasSession) {
		return NextResponse.next();
	}

	const signInUrl = new URL("/login", request.url);
	signInUrl.searchParams.set("reason", "unauthorized");
	signInUrl.searchParams.set("next", `${pathname}${search}`);
	return NextResponse.redirect(signInUrl);
}

export const config = {
	matcher: [
		"/home/:path*",
		"/spending/:path*",
		"/bills/:path*",
		"/receipts/:path*",
		"/ask/:path*",
		"/settings/:path*",
	],
};
