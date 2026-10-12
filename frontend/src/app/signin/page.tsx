import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, AuthWaiting } from "@/components/auth/auth-shell";
import SignInContent from "./signin-content";

export const metadata: Metadata = { title: "Log in" };

export default function SignInPage() {
	return (
		<Suspense
			fallback={
				<AuthShell headline={["Welcome", <><em>back</em>.</>]}>
					<AuthWaiting>Loading…</AuthWaiting>
				</AuthShell>
			}
		>
			<SignInContent />
		</Suspense>
	);
}
