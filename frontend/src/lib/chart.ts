// Small chart helpers shared by the Phase 5 pages (spec 2026-10-22 §3).

const n = (v: number) => +v.toFixed(2);

// A smooth SVG path through every point: monotone cubic (Fritsch–Carlson), so a running total never dips or
// overshoots between two days the way a plain Catmull-Rom curve does.
export function smoothPath(points: [number, number][]): string {
	if (!points.length) return "";
	const [x0, y0] = points[0];
	if (points.length === 1) return `M${n(x0)} ${n(y0)}`;
	const last = points.length - 1;
	const m = points.slice(0, last).map(([x, y], k) => (points[k + 1][1] - y) / (points[k + 1][0] - x || 1));
	const t = points.map((_, k) => (k === 0 ? m[0] : k === last ? m[last - 1] : m[k - 1] * m[k] <= 0 ? 0 : (m[k - 1] + m[k]) / 2));
	for (let k = 0; k < last; k++) {
		if (m[k] === 0) {
			t[k] = t[k + 1] = 0;
			continue;
		}
		const a = t[k] / m[k];
		const b = t[k + 1] / m[k];
		const s = a * a + b * b;
		if (s > 9) {
			const tau = 3 / Math.sqrt(s);
			t[k] = tau * a * m[k];
			t[k + 1] = tau * b * m[k];
		}
	}
	let d = `M${n(x0)} ${n(y0)}`;
	for (let k = 0; k < last; k++) {
		const [xa, ya] = points[k];
		const [xb, yb] = points[k + 1];
		const h = (xb - xa) / 3;
		d += ` C${n(xa + h)} ${n(ya + t[k] * h)} ${n(xb - h)} ${n(yb - t[k + 1] * h)} ${n(xb)} ${n(yb)}`;
	}
	return d;
}

// Axis labels that never overlap: `keep` ticks (first, today, last) always stay; any other tick is dropped when it
// sits closer than `minGap` px to a tick already shown.
export function pickTicks<T extends { x: number; keep?: boolean }>(candidates: T[], minGap: number): T[] {
	const kept = candidates.filter((c) => c.keep);
	const shown = [...kept];
	for (const c of candidates) {
		if (c.keep) continue;
		if (shown.every((s) => Math.abs(s.x - c.x) >= minGap)) shown.push(c);
	}
	return candidates.filter((c) => shown.includes(c));
}
