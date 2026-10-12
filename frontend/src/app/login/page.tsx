import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, AuthWaiting } from "@/components/auth/auth-shell";
import LoginContent from "./login-content";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<AuthShell headline={["Welcome", <><em>back</em>.</>]}>
					<AuthWaiting>Loading…</AuthWaiting>
				</AuthShell>
			}
		>
			<LoginContent />
		</Suspense>
	);
}
