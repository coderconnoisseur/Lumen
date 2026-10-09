"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// The free API host sleeps when idle (SPEC-DEPLOY). If /health hasn't answered in 3 s, say so until it does.
// The landing page doesn't need the API: it still pings (so the server is warm by "Get started") but shows nothing.
export function ServerWake() {
	const [waking, setWaking] = useState(false);
	const onLanding = usePathname() === "/";

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

	if (!waking || onLanding) return null;
	return (
		<div role="status" className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm text-black">
			Waking up the server (free hosting sleeps when idle). This takes about a minute…
		</div>
	);
}
