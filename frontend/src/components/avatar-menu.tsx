"use client";

import Link from "next/link";
import { KeyRound, LogOut, Settings } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { useProfile } from "@/components/profile/profile-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authApi } from "@/lib/api/client";

const initials = (name: string) =>
	name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]!.toUpperCase())
		.join("");

// Top-right account menu (spec section 3): the sidebar is navigation only.
export function AvatarMenu() {
	const { user } = useAuth();
	const { profile, avatarSrc } = useProfile();
	const name =
		profile?.display_name ?? user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email ?? "User";
	const email = user?.email ?? "";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Account menu"
				className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Avatar className="size-8">
					{avatarSrc && <AvatarImage src={avatarSrc} alt="" />}
					<AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
						{initials(name) || "U"}
					</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel className="font-normal">
					<p className="truncate text-sm font-medium">{name}</p>
					<p className="truncate text-xs text-muted-foreground">{email}</p>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/settings">
						<Settings />
						Settings
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link href="/settings#keys">
						<KeyRound />
						API keys
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => void authApi.logout()}>
					<LogOut />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
