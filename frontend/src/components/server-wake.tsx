"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// The free API host sleeps when idle (SPEC-DEPLOY). If /health hasn't answered in 3 s, say so until it does.
// The landing and sign-in pages don't need the API (sign-in talks to Supabase): they still ping, so the server is warm
// by the time the app opens, but show nothing.
export function ServerWake() {
	const [waking, setWaking] = useState(false);
	const quiet = ["/", "/signin", "/reset-password"].includes(usePathname());

	useEffect(() => {
		let done = false;
		const timer = setTimeout(() => !done && setWaking(true), 3000);
		const ping = async () => {
			while (!done) {
				try {
					const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/health`);
					if (res.ok) break;
				} catch {
					// still asleep or restarting
				}
				await new Promise((r) => setTimeout(r, 5000));
			}
			done = true;
			clearTimeout(timer);
			setWaking(false);
		};
		ping();
		return () => {
			done = true;
			clearTimeout(timer);
		};
	}, []);

	if (!waking || quiet) return null;
	return (
		<div
			role="status"
			className="fixed bottom-5 left-1/2 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-[#1c1c1e]/90 px-4 py-2 text-[13px] text-white/85 shadow-lg backdrop-blur"
		>
			<span className="size-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
			Waking up the server (free hosting sleeps when idle). About a minute…
		</div>
	);
}
