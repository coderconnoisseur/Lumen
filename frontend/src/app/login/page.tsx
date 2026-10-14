import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, AuthWaiting } from "@/components/auth/auth-shell";
import { LOGIN_HEADLINE } from "./headline";
import LoginContent from "./login-content";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<AuthShell headline={LOGIN_HEADLINE}>
					<AuthWaiting>Loading…</AuthWaiting>
				</AuthShell>
			}
		>
			<LoginContent />
		</Suspense>
	);
}
