import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ServerWake } from "@/components/server-wake";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const metadataBase = new URL(siteUrl);

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-sans",
});

const jetBrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
});

// Display serif (light, editorial headlines) and the uppercase label mono of the new look.
const newsreader = Newsreader({
	subsets: ["latin"],
	weight: ["300", "400", "500"],
	style: ["normal", "italic"],
	variable: "--font-newsreader",
});

// In-app card titles, tags and axis ticks (the `.label-mono` / `font-label` style).
const plexMono = IBM_Plex_Mono({
	subsets: ["latin"],
	weight: ["400", "500"],
	variable: "--font-plex-mono",
});

// Funnel Sans (OFL, self-hosted from @fontsource-variable/funnel-sans): text, buttons and labels on the landing,
// sign-in and onboarding pages, and the label style everywhere (it replaced Hanken Grotesk and Roboto Mono).
const funnelSans = localFont({
	src: "../../node_modules/@fontsource-variable/funnel-sans/files/funnel-sans-latin-wght-normal.woff2",
	weight: "300 800",
	variable: "--font-ui",
	display: "swap",
});

// Browser chrome (mobile address bar, scrollbars, form controls) matches the near-black pages.
export const viewport: Viewport = { themeColor: "#050505", colorScheme: "dark" };

export const metadata: Metadata = {
	metadataBase,
	applicationName: "Lumen",
	title: {
		default: "Lumen | AI Financial Dashboard for Invoice Operations",
		template: "%s | Lumen",
	},
	description:
		"Lumen is an AI financial dashboard for invoice operations, spend visibility, anomaly detection, and faster finance workflows.",
	keywords: [
		"financial dashboard",
		"invoice management",
		"accounts payable",
		"spend analytics",
		"invoice OCR",
		"finance automation",
		"anomaly detection",
	],
	category: "finance",
	creator: "Lumen",
	publisher: "Lumen",
	referrer: "origin-when-cross-origin",
	formatDetection: {
		email: false,
		address: false,
		telephone: false,
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-snippet": -1,
			"max-image-preview": "large",
			"max-video-preview": -1,
		},
	},
	openGraph: {
		type: "website",
		locale: "en_US",
		siteName: "Lumen",
		title: "Lumen | AI Financial Dashboard for Invoice Operations",
		description:
			"Lumen helps finance teams capture invoices, monitor spend, detect anomalies, and move faster through review and close.",
		images: [
			{
				url: "/favicon_io/android-chrome-512x512.png",
				width: 512,
				height: 512,
				alt: "Lumen logo",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "Lumen | AI Financial Dashboard for Invoice Operations",
		description:
			"AI-powered invoice operations, spend visibility, anomaly detection, and finance workflow acceleration.",
		images: ["/favicon_io/android-chrome-512x512.png"],
	},
	manifest: "/favicon_io/site.webmanifest",
	icons: {
		icon: [
			{ url: "/favicon_io/favicon.ico" },
			{
				url: "/favicon_io/favicon-16x16.png",
				sizes: "16x16",
				type: "image/png",
			},
			{
				url: "/favicon_io/favicon-32x32.png",
				sizes: "32x32",
				type: "image/png",
			},
		],
		shortcut: "/favicon_io/favicon.ico",
		apple: [
			{
				url: "/favicon_io/apple-touch-icon.png",
				sizes: "180x180",
				type: "image/png",
			},
		],
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
			style={{ colorScheme: "dark" }}
			className={`${inter.variable} ${jetBrainsMono.variable} ${newsreader.variable} ${plexMono.variable} ${funnelSans.variable} dark`}
		>
			<head>
				{/* every signed-in page talks to these two right away */}
				<link rel="preconnect" href={process.env.NEXT_PUBLIC_BACKEND_URL} crossOrigin="anonymous" />
				<link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
			</head>
			<body className="min-h-screen bg-background font-sans text-foreground antialiased">
				<a
					href="#main"
					className="sr-only z-[100] rounded-lg bg-white px-4 py-2 text-sm font-medium text-black focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
				>
					Skip to content
				</a>
				<ServerWake />
				<AuthProvider>{children}</AuthProvider>
			</body>
		</html>
	);
}
