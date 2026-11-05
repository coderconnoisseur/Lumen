"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_THEME } from "@/lib/app-theme";

// The app shell is gone by the time this shows, so it says which theme to draw itself (and Radix's portals) in.
export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<div data-app-theme={APP_THEME} className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
			<h1 className="text-2xl font-semibold text-foreground">
				Something went wrong
			</h1>
			<p className="max-w-md text-muted-foreground">
				We hit an unexpected error. You can try again or return to the
				dashboard.
			</p>
			<div className="flex gap-3">
				<Button onClick={() => reset()}>Try again</Button>
				<Button variant="outline" asChild>
					<Link href="/home">Go to home</Link>
				</Button>
			</div>
		</div>
	);
}
