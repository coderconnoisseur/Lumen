"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { AuthAlert, AuthShell, AuthWaiting, authLink, authPrimary } from "@/components/auth/auth-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// One-click demo (SPEC-DEPLOY): the landing page's demo links come here. A throwaway anonymous account gets its own
// copy of the demo data, then the visitor lands in the chat. Anyone already signed in goes straight to the chat.
export default function DemoPage() {
	const router = useRouter();
	const { loading, user } = useAuth();
	const started = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const start = useCallback(async () => {
		setError(null);
		try {
			const supabase = getSupabaseBrowserClient();
			const { data, error } = await supabase.auth.signInAnonymously();
			if (error || !data.session) throw error ?? new Error("No session");
			const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/demo/start`, {
				method: "POST",
				headers: { Authorization: `Bearer ${data.session.access_token}` },
			});
			if (!res.ok) throw new Error(`Demo setup failed (${res.status})`);
			router.replace("/chatbot");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Something went wrong.";
			// Don't leave the visitor signed in to an empty demo account: sign out so a retry starts clean.
			await getSupabaseBrowserClient().auth.signOut().catch(() => undefined);
			setError(`Couldn't start the demo. ${message}`);
		}
	}, [router]);

	// Decide once, when the session is known; the demo's own sign-in must not trigger the "already signed in" path.
	useEffect(() => {
		if (loading || started.current) return;
		started.current = true;
		if (user) router.replace("/chatbot");
		else start();
	}, [loading, user, router, start]);

	return (
		<AuthShell headline={["Your own", <>private <em>demo</em>.</>]}>
			{error ? (
				<div className="space-y-5">
					<AuthAlert tone="error">{error}</AuthAlert>
					<button type="button" onClick={start} className={authPrimary}>
						Try again <ArrowRight className="size-3.5" />
					</button>
					<p className="text-[14.5px] text-[#9f9fa0]">
						<Link href="/" className={authLink}>
							Back to home
						</Link>
					</p>
				</div>
			) : (
				<div className="space-y-3">
					<AuthWaiting>Setting up your demo…</AuthWaiting>
					<p className="auth-rise text-[14px] leading-[1.5] text-[#6a6b6b]" style={{ animationDelay: "200ms" }}>
						A year of sample spending, bills and documents, just for you. The first visit can take up to a minute
						while the server wakes up.
					</p>
				</div>
			)}
		</AuthShell>
	);
}
