import { Suspense } from "react";
import { AuthShell, AuthWaiting } from "@/components/auth/auth-shell";
import OnboardingContent from "./onboarding-content";

export default function OnboardingPage() {
	return (
		<Suspense
			fallback={
				<AuthShell headline={["Let's get to", <>know <em>you</em>.</>]}>
					<AuthWaiting>Loading…</AuthWaiting>
				</AuthShell>
			}
		>
			<OnboardingContent />
		</Suspense>
	);
}
