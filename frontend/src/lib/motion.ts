// Shared motion for the signed-in app: quiet and quick (150–250ms, ease-out, opacity/transform only).
// Reduced motion is handled globally (MotionConfig in the app layout + a CSS rule in globals.css).

export const DURATION = { fast: 0.15, base: 0.2, slow: 0.25 } as const;

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const fadeUp = {
	initial: { opacity: 0, y: 6 },
	animate: { opacity: 1, y: 0 },
	transition: { duration: DURATION.base, ease: EASE_OUT },
};
