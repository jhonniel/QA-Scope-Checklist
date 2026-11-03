/** RGB triple 0–255. */
type Rgb = readonly [number, number, number];

/**
 * Completion colours, matching `tokens.css`: empty work reads as danger,
 * mid-progress as warning then accent, and a finished bar as success.
 */
const STOPS: readonly { at: number; color: Rgb }[] = [
  { at: 0, color: [192, 57, 43] }, // --color-danger
  { at: 40, color: [183, 121, 31] }, // --color-warning
  { at: 72, color: [79, 70, 229] }, // --color-accent
  { at: 100, color: [47, 133, 90] }, // --color-success
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)];
}

function rgb({ color }: { color: Rgb }): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/** Solid fill colour for a 0–100 completion value. */
export function progressFillColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  for (let i = 1; i < STOPS.length; i++) {
    const end = STOPS[i];
    const start = STOPS[i - 1];
    if (p <= end.at) {
      const span = end.at - start.at;
      const t = span === 0 ? 1 : (p - start.at) / span;
      return rgb({ color: mix(start.color, end.color, t) });
    }
  }
  return rgb(STOPS[STOPS.length - 1]);
}
