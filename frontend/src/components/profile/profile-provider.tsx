"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { profileApi, type Profile } from "@/lib/api/client";

type Value = { profile: Profile | null; avatarSrc: string | null; refresh: () => Promise<void> };
const ProfileContext = createContext<Value>({ profile: null, avatarSrc: null, refresh: async () => {} });

/** Loads the profile once for the signed-in app (SPEC-ONBOARD) and sends accounts that haven't finished onboarding
 *  to /onboarding. Photo order: uploaded, then Google's, then none (the sidebar shows initials). */
export function ProfileProvider({ children }: { children: ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();
	const { user } = useAuth();
	const [profile, setProfile] = useState<Profile | null>(null);
	const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
	const [settled, setSettled] = useState(false); // loaded, or failed (then the app opens without a profile)
	// Auth events (token refresh, tab refocus) hand out a new user object; only a different account should reload.
	const userRef = useRef(user);
	userRef.current = user;
	const userId = user?.id;

	const refresh = useCallback(async () => {
		try {
			const p = await profileApi.get();
			setProfile(p);
			const meta = userRef.current?.user_metadata;
			const google: string | null = meta?.avatar_url ?? meta?.picture ?? null;
			setAvatarSrc(p.avatar_key ? await profileApi.avatarUrl(p.avatar_key).catch(() => google) : google);
		} finally {
			setSettled(true);
		}
	}, []);

	useEffect(() => {
		if (userId) refresh().catch(() => {});
	}, [userId, refresh]);

	// Object URLs hold the image in memory until revoked.
	useEffect(() => () => {
		if (avatarSrc?.startsWith("blob:")) URL.revokeObjectURL(avatarSrc);
	}, [avatarSrc]);

	const needsOnboarding = !!profile && !profile.onboarded && !profile.demo;
	useEffect(() => {
		if (needsOnboarding) {
			router.replace(`/onboarding?next=${encodeURIComponent(pathname)}`);
		}
	}, [needsOnboarding, pathname, router]);

	return (
		<ProfileContext.Provider value={{ profile, avatarSrc, refresh }}>
			{settled && !needsOnboarding ? (
				children
			) : (
				// first load only (the provider stays mounted): don't show the app before we know it's not onboarding
				<div className="flex min-h-screen w-full items-center justify-center bg-background">
					<Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading your profile…" />
				</div>
			)}
		</ProfileContext.Provider>
	);
}

export const useProfile = () => useContext(ProfileContext);
