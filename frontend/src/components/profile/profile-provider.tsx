"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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

	const refresh = useCallback(async () => {
		const p = await profileApi.get();
		setProfile(p);
		const google: string | null = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null;
		setAvatarSrc(p.avatar_key ? await profileApi.avatarUrl(p.avatar_key).catch(() => google) : google);
	}, [user]);

	useEffect(() => {
		refresh().catch(() => {});
	}, [refresh]);

	// Object URLs hold the image in memory until revoked.
	useEffect(() => () => {
		if (avatarSrc?.startsWith("blob:")) URL.revokeObjectURL(avatarSrc);
	}, [avatarSrc]);

	useEffect(() => {
		if (profile && !profile.onboarded && !profile.demo) {
			router.replace(`/onboarding?next=${encodeURIComponent(pathname)}`);
		}
	}, [profile, pathname, router]);

	return <ProfileContext.Provider value={{ profile, avatarSrc, refresh }}>{children}</ProfileContext.Provider>;
}

export const useProfile = () => useContext(ProfileContext);
