// Atmospheric backdrops drawn in CSS/SVG, standing in for photography: a drifting sky, soft-focus colour scenes
// for the feature cards, and rolling hills for the closing call to action.
// ponytail: drawn scenes, swap for licensed photos/video (next/image or <video>) when the owner picks some.

type Cloud = { top: string; left: string; w: number; h: number; o: number };

const CLOUDS: Cloud[] = [
	{ top: "8%", left: "-6%", w: 640, h: 170, o: 0.55 },
	{ top: "22%", left: "58%", w: 720, h: 200, o: 0.5 },
	{ top: "48%", left: "8%", w: 560, h: 150, o: 0.45 },
	{ top: "62%", left: "62%", w: 680, h: 190, o: 0.6 },
	{ top: "80%", left: "20%", w: 900, h: 240, o: 0.7 },
	{ top: "36%", left: "32%", w: 420, h: 110, o: 0.3 },
];

/** Daytime sky with slow-drifting clouds (hero). */
export function Sky() {
	return (
		<div aria-hidden className="absolute inset-0 overflow-hidden">
			<div className="absolute inset-0 bg-[linear-gradient(180deg,#1f5fa8_0%,#2f76bf_35%,#5596d2_70%,#8ab8e3_100%)]" />
			<div className="home-drift absolute -inset-x-[15%] inset-y-0">
				{CLOUDS.map((c, i) => (
					<span
						key={i}
						className="absolute rounded-[50%] bg-white blur-[48px]"
						style={{ top: c.top, left: c.left, width: c.w, height: c.h, opacity: c.o }}
					/>
				))}
			</div>
			<div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-black/20" />
		</div>
	);
}

const SCENES = {
	// late-afternoon dune: pale sky over a warm sand ridge
	dune: "radial-gradient(120% 70% at 30% 105%, #8a3f12 0%, #c0662a 35%, transparent 60%), radial-gradient(140% 60% at 80% 85%, #d98a44 0%, #b85f25 40%, transparent 70%), linear-gradient(180deg, #8fb3d9 0%, #c9b79a 45%, #c97a3d 75%, #7a3a12 100%)",
	// soft-focus meadow: greens with out-of-focus yellow blooms
	meadow:
		"radial-gradient(18% 14% at 22% 30%, rgb(250 240 120 / 0.55), transparent 70%), radial-gradient(14% 10% at 70% 22%, rgb(240 230 110 / 0.45), transparent 70%), radial-gradient(20% 14% at 55% 62%, rgb(220 235 120 / 0.4), transparent 70%), radial-gradient(120% 90% at 50% 120%, #1d4d14 0%, #2f6b1f 45%, #5a8f2e 75%, #8db84a 100%)",
	// dusk: violet sky fading into ink
	dusk: "radial-gradient(90% 70% at 20% 0%, #c9b8ff 0%, #847dff 30%, transparent 65%), radial-gradient(80% 80% at 90% 100%, #dd90d8 0%, transparent 55%), linear-gradient(180deg, #4b49aa 0%, #2a2766 60%, #141233 100%)",
	// bright bloom: white petals on deep green, out of focus
	bloom:
		"radial-gradient(10% 8% at 15% 20%, rgb(255 255 255 / 0.75), transparent 70%), radial-gradient(9% 7% at 78% 18%, rgb(255 255 255 / 0.7), transparent 70%), radial-gradient(12% 9% at 88% 64%, rgb(255 255 255 / 0.65), transparent 70%), radial-gradient(10% 8% at 8% 72%, rgb(255 255 255 / 0.6), transparent 70%), radial-gradient(6% 5% at 30% 86%, rgb(250 220 90 / 0.6), transparent 70%), radial-gradient(7% 5% at 64% 80%, rgb(250 220 90 / 0.55), transparent 70%), radial-gradient(130% 100% at 50% 50%, #3d6b2a 0%, #1f3d16 60%, #0f1f0b 100%)",
} as const;

/** A soft-focus colour scene that fills its (rounded) parent. */
export function Scene({ name }: { name: keyof typeof SCENES }) {
	return (
		<div aria-hidden className="absolute inset-0">
			<div className="absolute inset-0 scale-110 blur-[6px]" style={{ background: SCENES[name] }} />
			<div className="absolute inset-0 bg-black/10" />
		</div>
	);
}

/** Rolling green hills under a pale sky (closing call to action). */
export function Hills() {
	return (
		<svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice">
			<defs>
				<linearGradient id="hills-sky" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#6f9fcf" />
					<stop offset="1" stopColor="#cfe0ec" />
				</linearGradient>
				<linearGradient id="hills-far" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#5f8f4a" />
					<stop offset="1" stopColor="#3f6e2c" />
				</linearGradient>
				<linearGradient id="hills-mid" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#3f7a2a" />
					<stop offset="1" stopColor="#25531a" />
				</linearGradient>
				<linearGradient id="hills-near" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#2c6420" />
					<stop offset="1" stopColor="#123510" />
				</linearGradient>
			</defs>
			<rect width="1440" height="640" fill="url(#hills-sky)" />
			<path d="M0 330 C 240 260 420 300 640 280 S 1080 220 1440 290 V640 H0Z" fill="url(#hills-far)" />
			<path d="M0 420 C 300 340 520 400 760 370 S 1180 330 1440 380 V640 H0Z" fill="url(#hills-mid)" />
			<path d="M0 520 C 260 450 560 500 820 470 S 1240 440 1440 480 V640 H0Z" fill="url(#hills-near)" />
			{[0, 1, 2, 3, 4, 5].map((i) => (
				<path
					key={i}
					d={`M${-200 + i * 260} 640 C ${-80 + i * 260} 560 ${40 + i * 260} 500 ${180 + i * 260} 440`}
					stroke="rgb(0 0 0 / 0.12)"
					strokeWidth="3"
					fill="none"
				/>
			))}
			<rect width="1440" height="640" fill="url(#hills-sky)" opacity="0.08" />
		</svg>
	);
}
