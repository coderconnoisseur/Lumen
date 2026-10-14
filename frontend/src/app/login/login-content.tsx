"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
	AuthAlert,
	AuthShell,
	AuthWaiting,
	authInput,
	authLabel,
	authLink,
	authPrimary,
	authSecondary,
	mono,
	rise,
} from "@/components/auth/auth-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "reset";

const MIN_PASSWORD_LENGTH = 8;

const HEADLINES: Record<Mode, ReactNode[]> = {
	signin: ["Welcome", <><em>back</em>.</>],
	signup: ["Start minding", <>your <em>money</em>.</>],
	reset: ["It happens", <>to <em>everyone</em>.</>],
};

const TITLES: Record<Mode, ReactNode> = {
	signin: <>Log in to <em>Lumen</em></>,
	signup: <>Create your <em>account</em></>,
	reset: <>Reset your <em>password</em></>,
};

// Only allow same-origin relative paths. "//host" and "/\host" are treated by
// browsers as protocol-relative URLs and would redirect off-site.
function safeNextPath(next: string | null): string {
	if (!next || !next.startsWith("/")) return "/dashboard";
	if (next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
	return next;
}

function friendlyAuthError(message: string): string {
	if (/email not confirmed/i.test(message)) {
		return "Confirm your email first. Check your inbox for the confirmation link.";
	}
	if (/invalid login credentials/i.test(message)) {
		return "That email and password don't match. Try again or reset your password.";
	}
	if (/rate limit/i.test(message)) {
		return "Too many emails went out just now. Wait a few minutes and try again.";
	}
	if (/link is invalid or has expired/i.test(message)) {
		return "That email link has expired or was already used. Log in, or request a new link.";
	}
	return message;
}

// Supabase reports a failed email or Google link in the URL fragment (#error=...&error_description=...).
function errorFromUrlFragment(): string | null {
	const params = new URLSearchParams(window.location.hash.slice(1));
	const description = params.get("error_description");
	return description ? friendlyAuthError(description.replace(/\+/g, " ")) : null;
}

function GoogleMark() {
	return (
		<svg aria-hidden viewBox="0 0 24 24" className="size-[18px]">
			<path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
			<path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
			<path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.76l4.01-3.1z" />
			<path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77z" />
		</svg>
	);
}

export default function LoginContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { loading, user: sessionUser } = useAuth();
	// A demo visitor (anonymous session) can still log in or sign up here, so only a real account counts.
	const user = sessionUser?.is_anonymous ? null : sessionUser;

	const next = safeNextPath(searchParams.get("next"));
	// The mode lives in the URL (?mode=signup|reset), so refresh, Back and shared links keep it.
	const modeParam = searchParams.get("mode");
	const mode: Mode = modeParam === "signup" || modeParam === "reset" ? modeParam : "signin";
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [signedIn, setSignedIn] = useState(false);
	const [isStartingGoogle, setIsStartingGoogle] = useState(false);
	const [authError, setAuthError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		if (!loading && user) {
			router.replace(next);
		}
	}, [loading, next, router, user]);

	useEffect(() => {
		const fragmentError = errorFromUrlFragment();
		if (fragmentError) {
			setAuthError(fragmentError);
			window.history.replaceState(null, "", window.location.pathname + window.location.search);
		}
	}, []);

	const reasonCopy = useMemo(() => {
		const reason = searchParams.get("reason");
		if (reason === "expired") {
			return "Your session expired. Log in again to continue.";
		}
		if (reason === "unauthorized") {
			return "Log in to open that page.";
		}
		return "Pick up right where you left off.";
	}, [searchParams]);

	const subtitle =
		mode === "signup"
			? "Free to use. Bring your bills, receipts and questions."
			: mode === "reset"
			  ? "Enter your email and we'll send you a link to set a new password."
			  : reasonCopy;

	const switchMode = (nextMode: Mode) => {
		const params = new URLSearchParams(searchParams.toString());
		if (nextMode === "signin") params.delete("mode");
		else params.set("mode", nextMode);
		const query = params.toString();
		router.push(query ? `/login?${query}` : "/login", { scroll: false });
		setAuthError(null);
		setNotice(null);
	};

	// Where Supabase sends the user back after clicking an email link. It must
	// be listed under Auth -> URL Configuration -> Redirect URLs in Supabase.
	const signInReturnUrl = () =>
		`${window.location.origin}/login?next=${encodeURIComponent(next)}`;

	const handleEmailSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setAuthError(null);
		setNotice(null);
		setSubmitting(true);

		try {
			const supabase = getSupabaseBrowserClient();

			if (mode === "signin") {
				const { error } = await supabase.auth.signInWithPassword({
					email,
					password,
				});
				if (error) throw error;
				// AuthProvider picks up the new session and the effect above redirects.
				setSignedIn(true);
			} else if (mode === "signup") {
				const { data, error } = await supabase.auth.signUp({
					email,
					password,
					options: { emailRedirectTo: signInReturnUrl() },
				});
				if (error) throw error;
				if (data.session) {
					setSignedIn(true);
				} else {
					// Email confirmation is on: no session until the link is clicked.
					setNotice(
						`We sent a confirmation link to ${email}. Open it to finish creating your account.`
					);
					setPassword("");
				}
			} else {
				const { error } = await supabase.auth.resetPasswordForEmail(email, {
					redirectTo: `${window.location.origin}/reset-password`,
				});
				if (error) throw error;
				// Same message whether or not the account exists (no user enumeration).
				setNotice(
					`If an account exists for ${email}, a password reset link is on its way.`
				);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Something went wrong. Try again.";
			setAuthError(friendlyAuthError(message));
		} finally {
			setSubmitting(false);
		}
	};

	const handleGoogleSignIn = async () => {
		setIsStartingGoogle(true);
		setAuthError(null);
		setNotice(null);

		try {
			const supabase = getSupabaseBrowserClient();
			const { error } = await supabase.auth.signInWithOAuth({
				provider: "google",
				options: { redirectTo: signInReturnUrl() },
			});
			if (error) throw error;
		} catch (error) {
			console.error("Failed to start sign-in flow:", error);
			const message =
				error instanceof Error
					? error.message
					: "Check your Supabase and Google OAuth settings.";
			setAuthError(`Couldn't start Google sign-in. ${message}`);
			setIsStartingGoogle(false);
		}
	};

	if (loading || (user && !signedIn)) {
		return (
			<AuthShell headline={HEADLINES.signin}>
				<AuthWaiting>{loading ? "Checking your session…" : "Taking you in…"}</AuthWaiting>
			</AuthShell>
		);
	}

	const submitLabel =
		mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Log in";

	return (
		<AuthShell headline={HEADLINES[mode]} headlineKey={mode}>
			{/* keyed by mode so the rows rise in again when switching */}
			<div key={mode}>
				<h1 style={rise(0)} className="auth-rise font-display text-[34px] leading-[1.1] font-light tracking-[-0.01em] sm:text-[40px]">
					{TITLES[mode]}
				</h1>
				<p style={rise(1)} className="auth-rise mt-3 text-[15.5px] leading-[1.5] text-[#9f9fa0]">
					{subtitle}
				</p>

				{mode !== "reset" ? (
					<>
						<div style={rise(2)} className="auth-rise mt-8">
							<button
								type="button"
								onClick={handleGoogleSignIn}
								disabled={isStartingGoogle}
								className={authSecondary}
							>
								{isStartingGoogle ? <Loader2 className="size-4 animate-spin" /> : <GoogleMark />}
								Continue with Google
							</button>
						</div>
						<div
							style={rise(3)}
							className={`auth-rise ${mono} my-6 flex items-center gap-3 text-[10.5px] text-[#4a4a4c]`}
						>
							<span className="h-px flex-1 bg-white/[0.08]" />
							or
							<span className="h-px flex-1 bg-white/[0.08]" />
						</div>
					</>
				) : null}

				<form
					onSubmit={handleEmailSubmit}
					style={rise(4)}
					className={`auth-rise space-y-5 ${mode === "reset" ? "mt-8" : ""}`}
				>
					<div className="space-y-2">
						<label htmlFor="email" className={authLabel}>
							Email
						</label>
						<input
							id="email"
							name="email"
							spellCheck={false}
							type="email"
							required
							autoComplete="email"
							placeholder="you@company.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className={authInput}
						/>
					</div>

					{mode !== "reset" ? (
						<div className="space-y-2">
							<label htmlFor="password" className={authLabel}>
								Password
							</label>
							<div className="relative">
								<input
									id="password"
									name="password"
									type={showPassword ? "text" : "password"}
									required
									minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined}
									autoComplete={mode === "signup" ? "new-password" : "current-password"}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									className={`${authInput} pr-11`}
								/>
								<button
									type="button"
									onClick={() => setShowPassword((s) => !s)}
									aria-label={showPassword ? "Hide password" : "Show password"}
									className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[#6a6b6b] transition-colors hover:text-white"
								>
									{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
								</button>
							</div>
							{mode === "signin" ? (
								<button
									type="button"
									onClick={() => switchMode("reset")}
									className="text-[13.5px] text-[#9f9fa0] transition-colors hover:text-white"
								>
									Forgot password?
								</button>
							) : (
								<p className="text-[13.5px] text-[#6a6b6b]">At least {MIN_PASSWORD_LENGTH} characters.</p>
							)}
						</div>
					) : null}

					<button type="submit" disabled={submitting || signedIn} className={authPrimary}>
						{signedIn ? (
							<>
								<Check className="size-4" /> Signed in
							</>
						) : submitting ? (
							<>
								<Loader2 className="size-4 animate-spin" /> {submitLabel}
							</>
						) : (
							<>
								{submitLabel} <ArrowRight className="size-3.5" />
							</>
						)}
					</button>
				</form>

				{notice || authError ? (
					<div className="mt-5 space-y-3">
						{notice ? <AuthAlert tone="notice">{notice}</AuthAlert> : null}
						{authError ? <AuthAlert tone="error">{authError}</AuthAlert> : null}
					</div>
				) : null}

				<p style={rise(5)} className="auth-rise mt-8 text-[14.5px] text-[#9f9fa0]">
					{mode === "signin" ? (
						<>
							Don&apos;t have an account?{" "}
							<button type="button" onClick={() => switchMode("signup")} className={authLink}>
								Sign up
							</button>
						</>
					) : (
						<>
							{mode === "signup" ? "Already have an account? " : "Remembered it? "}
							<button type="button" onClick={() => switchMode("signin")} className={authLink}>
								Log in
							</button>
						</>
					)}
				</p>
			</div>
		</AuthShell>
	);
}
