"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
	AuthAlert,
	AuthShell,
	AuthWaiting,
	authInput,
	authLabel,
	authPrimary,
	rise,
} from "@/components/auth/auth-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

// Landing page for the link in Supabase's password-reset email. The Supabase
// client reads the recovery token from the URL on load and opens a session,
// which AuthProvider exposes as `user`; with that session we can set a new
// password via updateUser().
export default function ResetPasswordPage() {
	const router = useRouter();
	const { loading, user } = useAuth();
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);

		if (password.length < MIN_PASSWORD_LENGTH) {
			setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
			return;
		}
		if (password !== confirm) {
			setError("The two passwords don't match.");
			return;
		}

		setSubmitting(true);
		try {
			const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({
				password,
			});
			if (updateError) throw updateError;
			router.replace("/dashboard");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't update your password.");
			setSubmitting(false);
		}
	};

	return (
		<AuthShell headline={["A fresh", <>start, <em>secured</em>.</>]}>
			{loading ? (
				<AuthWaiting>Checking your reset link…</AuthWaiting>
			) : (
				<>
					<h1 style={rise(0)} className="auth-rise font-display text-[34px] leading-[1.1] font-light tracking-[-0.01em] sm:text-[40px]">
						Set a new <em>password</em>
					</h1>
					<p style={rise(1)} className="auth-rise mt-3 text-[15.5px] leading-[1.5] text-[#9f9fa0]">
						{user
							? `Choose a new password for ${user.email ?? "your account"}.`
							: "This reset link is invalid or has expired."}
					</p>

					{user ? (
						<form onSubmit={handleSubmit} style={rise(2)} className="auth-rise mt-8 space-y-5">
							<div className="space-y-2">
								<label htmlFor="new-password" className={authLabel}>
									New password
								</label>
								<input
									id="new-password"
									type="password"
									required
									minLength={MIN_PASSWORD_LENGTH}
									autoComplete="new-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									className={authInput}
								/>
								<p className="text-[13.5px] text-[#6a6b6b]">At least {MIN_PASSWORD_LENGTH} characters.</p>
							</div>
							<div className="space-y-2">
								<label htmlFor="confirm-password" className={authLabel}>
									Confirm new password
								</label>
								<input
									id="confirm-password"
									type="password"
									required
									autoComplete="new-password"
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
									className={authInput}
								/>
							</div>
							<button type="submit" disabled={submitting} className={authPrimary}>
								{submitting ? (
									<>
										<Loader2 className="size-4 animate-spin" /> Saving…
									</>
								) : (
									<>
										Update password <ArrowRight className="size-3.5" />
									</>
								)}
							</button>
						</form>
					) : (
						<Link href="/signin?mode=reset" style={rise(2)} className={`auth-rise mt-8 ${authPrimary}`}>
							Request a new link <ArrowRight className="size-3.5" />
						</Link>
					)}

					{error ? (
						<div className="mt-5">
							<AuthAlert tone="error">{error}</AuthAlert>
						</div>
					) : null}
				</>
			)}
		</AuthShell>
	);
}
