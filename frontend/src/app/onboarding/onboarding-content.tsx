"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Camera, Check, Loader2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import {
	AuthAlert,
	AuthShell,
	AuthWaiting,
	authInput,
	authLabel,
	authPrimary,
	authSecondary,
	mono,
	rise,
} from "@/components/auth/auth-shell";
import { profileApi, type Goal, type Profile } from "@/lib/api/client";
import { CURRENCIES, currencyLabel, guessCurrency } from "@/lib/currency";

// SPEC-ONBOARD: three short steps, once, after a new account is created. The step lives in the URL (?step=2) and
// each step saves on Continue, so refresh, Back and a closed tab resume where the user left off.

type Step = 1 | 2 | 3;

const HEADLINES: Record<Step, ReactNode[]> = {
	1: ["Let's get to", <>know <em>you</em>.</>],
	2: ["Your money,", <>your <em>way</em>.</>],
	3: ["What matters", <><em>most</em>?</>],
};

const TITLES: Record<Step, [ReactNode, string]> = {
	1: [<>Tell us about <em>you</em></>, "This is how Lumen will greet you."],
	2: [<>Your <em>money</em></>, "So amounts and advice fit you. You can change these any time."],
	3: [<>Your <em>goals</em></>, "Pick any. Lumen will put these first."],
};

const USE_CASES: [NonNullable<Profile["use_case"]>, string, string][] = [
	["personal", "Just me", "My own spending, bills and savings"],
	["household", "My household", "Shared bills, groceries, family spending"],
	["business", "My business", "Invoices, vendors and freelance work"],
];

const GOALS: [Goal, string][] = [
	["save_more", "Save more each month"],
	["cut_subscriptions", "Cut unused subscriptions"],
	["stay_on_budget", "Stay on budget"],
	["pay_off_debt", "Pay off debt"],
	["emergency_fund", "Build an emergency fund"],
	["big_purchase", "Plan a big purchase"],
	["business_expenses", "Keep business expenses in order"],
];

function safeNext(next: string | null): string {
	if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
	return next;
}

/** "50,000" → 50000; "" → null; anything else → NaN (shown as a field error). */
function parseAmount(raw: string): number | null {
	const clean = raw.replace(/[\s,]/g, "");
	if (!clean) return null;
	const n = Number(clean);
	return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** Centre-crop to a 256 px square JPEG, so uploads are small whatever the camera made. */
async function shrinkPhoto(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const side = Math.min(bitmap.width, bitmap.height);
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 256;
	canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.88)
	);
}

function apiMessage(error: unknown): string {
	const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
	if (typeof detail === "string") return detail;
	return "Something went wrong saving that. Check your connection and try again.";
}

function FieldError({ id, children }: { id: string; children?: string }) {
	return children ? (
		<p id={id} className="text-[13.5px] text-red-300">
			{children}
		</p>
	) : null;
}

export default function OnboardingContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { loading, user } = useAuth();
	const raw = Number(searchParams.get("step"));
	const step: Step = raw === 2 || raw === 3 ? raw : 1;
	const next = safeNext(searchParams.get("next"));

	const [ready, setReady] = useState(false);
	const [name, setName] = useState("");
	const [photo, setPhoto] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [currency, setCurrency] = useState("USD");
	const [income, setIncome] = useState("");
	const [budget, setBudget] = useState("");
	const [useCase, setUseCase] = useState<Profile["use_case"]>(null);
	const [goals, setGoals] = useState<Goal[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	useEffect(() => {
		if (loading) return;
		if (!user) {
			router.replace("/login?next=%2Fonboarding");
			return;
		}
		if (user.is_anonymous) {
			router.replace("/dashboard"); // demo visitors never onboard
			return;
		}
		const meta = user.user_metadata ?? {};
		profileApi
			.get()
			.then(async (p) => {
				setName(p.display_name ?? meta.full_name ?? meta.name ?? "");
				setCurrency(p.currency ?? guessCurrency(navigator.language));
				setIncome(p.monthly_income != null ? String(p.monthly_income) : "");
				setBudget(p.monthly_budget != null ? String(p.monthly_budget) : "");
				setUseCase(p.use_case);
				setGoals(p.goals);
				setPhoto(
					p.avatar_key
						? await profileApi.avatarUrl(p.avatar_key).catch(() => null)
						: (meta.avatar_url ?? meta.picture ?? null)
				);
			})
			.catch((e) => setError(apiMessage(e)))
			.finally(() => setReady(true));
	}, [loading, user, router]);

	const go = (to: Step) => {
		setError(null);
		setFieldErrors({});
		router.push(`/onboarding?step=${to}&next=${encodeURIComponent(next)}`, { scroll: false });
	};

	const choosePhoto = async (file: File | undefined) => {
		if (!file) return;
		setError(null);
		setUploading(true);
		try {
			const small = await shrinkPhoto(file);
			await profileApi.uploadAvatar(small);
			setPhoto(URL.createObjectURL(small));
		} catch (e) {
			setError(e instanceof Error && !("response" in e) ? e.message : apiMessage(e));
		} finally {
			setUploading(false);
		}
	};

	const submit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const errors: Record<string, string> = {};
		let update: Parameters<typeof profileApi.update>[0] = {};
		if (step === 1) {
			if (!name.trim()) errors.name = "Enter your name.";
			update = { display_name: name.trim().slice(0, 60) };
		} else if (step === 2) {
			const inc = parseAmount(income);
			const bud = parseAmount(budget);
			if (Number.isNaN(inc)) errors.income = "Enter a number, like 50000, or leave it empty.";
			if (Number.isNaN(bud)) errors.budget = "Enter a number, like 30000, or leave it empty.";
			if (!useCase) errors.useCase = "Choose who Lumen is for.";
			update = { currency, monthly_income: inc, monthly_budget: bud, use_case: useCase };
		} else {
			update = { goals, complete: true };
		}
		setFieldErrors(errors);
		if (Object.keys(errors).length) {
			document.getElementById(Object.keys(errors)[0])?.focus();
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await profileApi.update(update);
			if (step === 3) router.replace(next);
			else go((step + 1) as Step);
		} catch (err) {
			setError(apiMessage(err));
		} finally {
			setSaving(false);
		}
	};

	if (!ready) {
		return (
			<AuthShell headline={HEADLINES[1]}>
				<AuthWaiting>Loading…</AuthWaiting>
			</AuthShell>
		);
	}

	const [title, subtitle] = TITLES[step];
	const submitLabel = step === 3 ? "Finish" : "Continue";

	return (
		<AuthShell headline={HEADLINES[step]} headlineKey={String(step)}>
			<div key={step}>
				<p style={rise(0)} className={`auth-rise ${mono} text-[10.5px] font-medium text-[#6a6b6b]`}>
					{step} of 3
				</p>
				<h1 style={rise(0)} className="auth-rise mt-3 font-display text-[34px] leading-[1.1] font-light tracking-[-0.01em] sm:text-[40px]">
					{title}
				</h1>
				<p style={rise(1)} className="auth-rise mt-3 text-[15.5px] leading-[1.5] text-[#9f9fa0]">
					{subtitle}
				</p>

				<form onSubmit={submit} noValidate style={rise(2)} className="auth-rise mt-8 space-y-6">
					{step === 1 && (
						<>
							<div className="flex items-center gap-4">
								<label
									htmlFor="photo"
									className="group relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[#1c1c1e] ring-1 ring-white/10 transition-colors hover:ring-white/30"
								>
									{photo ? (
										// eslint-disable-next-line @next/next/no-img-element -- object/Google URLs, not optimisable
										<img src={photo} alt="" className="size-full object-cover" />
									) : (
										<Camera className="size-5 text-[#9f9fa0]" />
									)}
									{uploading && (
										<span className="absolute inset-0 flex items-center justify-center bg-black/50">
											<Loader2 className="size-4 animate-spin" />
										</span>
									)}
								</label>
								<div>
									<label htmlFor="photo" className="cursor-pointer text-[14.5px] text-white underline-offset-4 hover:underline">
										{photo ? "Change photo" : "Add a photo"}
									</label>
									<p className="text-[13.5px] text-[#6a6b6b]">Optional. PNG, JPEG or WebP.</p>
								</div>
								<input
									id="photo"
									type="file"
									accept="image/png,image/jpeg,image/webp"
									className="sr-only"
									onChange={(e) => choosePhoto(e.target.files?.[0])}
								/>
							</div>
							<div className="space-y-2">
								<label htmlFor="name" className={authLabel}>
									Your name
								</label>
								<input
									id="name"
									name="name"
									autoComplete="name"
									maxLength={60}
									value={name}
									onChange={(e) => setName(e.target.value)}
									aria-invalid={!!fieldErrors.name}
									aria-describedby="name-error"
									placeholder="Asha Rao"
									className={authInput}
								/>
								<FieldError id="name-error">{fieldErrors.name}</FieldError>
							</div>
						</>
					)}

					{step === 2 && (
						<>
							<div className="space-y-2">
								<label htmlFor="currency" className={authLabel}>
									Main currency
								</label>
								<select
									id="currency"
									value={currency}
									onChange={(e) => setCurrency(e.target.value)}
									className={`${authInput} bg-[#111113] text-white`}
								>
									{CURRENCIES.map((c) => (
										<option key={c} value={c} className="bg-[#111113] text-white">
											{currencyLabel(c)}
										</option>
									))}
								</select>
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								{(
									[
										["income", "Monthly take-home", income, setIncome, "50000"],
										["budget", "Monthly budget", budget, setBudget, "30000"],
									] as const
								).map(([id, label, value, set, example]) => (
									<div key={id} className="space-y-2">
										<label htmlFor={id} className={authLabel}>
											{label}
										</label>
										<input
											id={id}
											inputMode="decimal"
											autoComplete="off"
											value={value}
											onChange={(e) => set(e.target.value)}
											aria-invalid={!!fieldErrors[id]}
											aria-describedby={`${id}-error`}
											placeholder={example}
											className={`${authInput} tabular-nums`}
										/>
										<FieldError id={`${id}-error`}>{fieldErrors[id]}</FieldError>
									</div>
								))}
							</div>
							<p className="-mt-3 text-[13.5px] text-[#6a6b6b]">Approximate, private and optional.</p>
							<fieldset className="space-y-2">
								<legend className={`${authLabel} mb-2`}>Who is Lumen for?</legend>
								<div id="useCase" tabIndex={-1} className="grid gap-2 outline-none">
									{USE_CASES.map(([value, label, hint]) => (
										<label
											key={value}
											className={`flex cursor-pointer items-center gap-3 rounded-lg px-3.5 py-3 ring-1 transition-colors ${
												useCase === value ? "bg-white/[0.06] ring-white/40" : "bg-[#111113] ring-white/[0.08] hover:ring-white/20"
											}`}
										>
											<input
												type="radio"
												name="use_case"
												value={value}
												checked={useCase === value}
												onChange={() => setUseCase(value)}
												className="size-4 accent-white"
											/>
											<span>
												<span className="block text-[15px]">{label}</span>
												<span className="block text-[13.5px] text-[#6a6b6b]">{hint}</span>
											</span>
										</label>
									))}
								</div>
								<FieldError id="useCase-error">{fieldErrors.useCase}</FieldError>
							</fieldset>
						</>
					)}

					{step === 3 && (
						<fieldset>
							<legend className="sr-only">Your goals</legend>
							<div className="flex flex-wrap gap-2">
								{GOALS.map(([value, label]) => {
									const on = goals.includes(value);
									return (
										<label
											key={value}
											className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-[14.5px] ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white ${
												on ? "bg-white text-black ring-white" : "bg-[#111113] text-white ring-white/[0.08] hover:ring-white/25"
											}`}
										>
											<input
												type="checkbox"
												checked={on}
												onChange={() => setGoals(on ? goals.filter((g) => g !== value) : [...goals, value])}
												className="sr-only"
											/>
											{on && <Check className="size-3.5" />}
											{label}
										</label>
									);
								})}
							</div>
						</fieldset>
					)}

					{error && <AuthAlert tone="error">{error}</AuthAlert>}

					<div className={step > 1 ? "grid grid-cols-[7rem_1fr] gap-3" : ""}>
						{step > 1 && (
							<button type="button" onClick={() => go((step - 1) as Step)} className={authSecondary}>
								Back
							</button>
						)}
						<button type="submit" disabled={saving || uploading} className={authPrimary}>
							{saving ? <Loader2 className="size-4 animate-spin" /> : null}
							{submitLabel}
							{!saving && <ArrowRight className="size-3.5" />}
						</button>
					</div>
				</form>
			</div>
		</AuthShell>
	);
}
