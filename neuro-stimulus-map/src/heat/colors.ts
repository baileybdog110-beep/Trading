/**
 * Heat ramp for the estimated heat map, drawn on a dark stage: lightness rises steadily from the
 * cold brain surface through crimson, red and orange to pale yellow, so "hotter" always reads as
 * "brighter" (and survives colour-vision deficiencies and grayscale).
 */
export const HEAT_STOPS: [number, string][] = [
  [0, '#2e333b'],
  [0.2, '#7a1f3d'],
  [0.42, '#c0282d'],
  [0.64, '#ee6a1f'],
  [0.84, '#fbb125'],
  [1, '#ffe27a'],
];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const STOPS = HEAT_STOPS.map(([v, h]) => [v, hex(h)] as const);

/** 256-entry lookup table of linear-ish RGB (0..1) triples. */
const LUT: [number, number, number][] = Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  let k = 0;
  while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
  const [v0, c0] = STOPS[k];
  const [v1, c1] = STOPS[k + 1];
  const f = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
  return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
});

export function heatRGB(v: number): [number, number, number] {
  return LUT[Math.max(0, Math.min(255, Math.round(v * 255)))];
}

export function heatCSS(v: number): string {
  const [r, g, b] = heatRGB(v);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** CSS gradient of the whole ramp, for legends. */
export const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.map(([v, h]) => `${h} ${Math.round(v * 100)}%`).join(', ')})`;
