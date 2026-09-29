/**
 * Pure per-frame statistics on small downscaled frames (RGBA ImageData-like buffers).
 * Used for cut detection, brightness change and a coarse motion estimate.
 */

export interface SmallFrame {
  width: number;
  height: number;
  /** RGBA bytes */
  data: Uint8ClampedArray;
}

export interface FrameSummary {
  gray: Float32Array;
  hist: Float32Array; // 64-bin RGB histogram (4x4x4), normalised
  luma: number; // 0..1
  /** mean HSV saturation, 0..1 */
  sat: number;
}

export function summarize(f: SmallFrame): FrameSummary {
  const n = f.width * f.height;
  const gray = new Float32Array(n);
  const hist = new Float32Array(64);
  let sum = 0;
  let sat = 0;
  for (let i = 0; i < n; i++) {
    const r = f.data[i * 4];
    const g = f.data[i * 4 + 1];
    const b = f.data[i * 4 + 2];
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    gray[i] = y;
    sum += y;
    const mx = Math.max(r, g, b);
    if (mx > 0) sat += (mx - Math.min(r, g, b)) / mx;
    hist[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)] += 1 / n;
  }
  return { gray, hist, luma: sum / n, sat: sat / n };
}

/** Half L1 distance between normalised histograms, 0..1. */
export function histDistance(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

export interface MotionEstimate {
  /** median block displacement (px, at summary resolution) */
  globalPx: number;
  /** mean deviation of block vectors from the median (px) */
  localPx: number;
  /** mean absolute difference after global compensation, 0..1 */
  residual: number;
  /** fraction of pixels that changed by more than 10% of full scale after compensation */
  changed: number;
}

/** Coarse block matching (8x8 blocks, +/-8 px search) between two grayscale frames. */
export function estimateMotion(a: Float32Array, b: Float32Array, w: number, h: number, block = 8, search = 8): MotionEstimate {
  const vx: number[] = [];
  const vy: number[] = [];
  for (let by = search; by + block + search <= h; by += block) {
    for (let bx = search; bx + block + search <= w; bx += block) {
      let best = Infinity;
      let bdx = 0;
      let bdy = 0;
      let texture = 0;
      for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) texture += Math.abs(a[(by + y) * w + bx + x] - a[(by + y) * w + bx + Math.min(block - 1, x + 1)]);
      if (texture < 0.02 * block * block) continue; // flat block: motion undefined
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          let sad = 0;
          for (let y = 0; y < block; y++) {
            const ra = (by + y) * w + bx;
            const rb = (by + y + dy) * w + bx + dx;
            for (let x = 0; x < block; x++) sad += Math.abs(a[ra + x] - b[rb + x]);
          }
          if (sad < best - 1e-6 || (Math.abs(sad - best) < 1e-6 && Math.hypot(dx, dy) < Math.hypot(bdx, bdy))) {
            best = sad;
            bdx = dx;
            bdy = dy;
          }
        }
      }
      vx.push(bdx);
      vy.push(bdy);
    }
  }
  const med = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const gx = med(vx);
  const gy = med(vy);
  let local = 0;
  for (let i = 0; i < vx.length; i++) local += Math.hypot(vx[i] - gx, vy[i] - gy);
  local = vx.length ? local / vx.length : 0;
  let res = 0;
  let cnt = 0;
  let changed = 0;
  for (let y = Math.max(0, -gy); y < Math.min(h, h - gy); y++) {
    for (let x = Math.max(0, -gx); x < Math.min(w, w - gx); x++) {
      const d = Math.abs(a[y * w + x] - b[(y + gy) * w + x + gx]);
      res += d;
      if (d > 0.1) changed++;
      cnt++;
    }
  }
  return { globalPx: Math.hypot(gx, gy), localPx: local, residual: cnt ? res / cnt : 0, changed: cnt ? changed / cnt : 0 };
}

/**
 * Remove "cuts" that are really brief flashes: the image jumps away and returns to
 * (nearly) the pre-jump histogram within `window` samples. Returns the kept cuts and the flashes.
 */
export function separateFlashes(times: number[], hists: Float32Array[], cuts: number[], window = 3, returnDist = 0.2): { cuts: number[]; flashes: number[] } {
  const kept: number[] = [];
  const flashes: number[] = [];
  const intervals: [number, number][] = [];
  for (const c of cuts) {
    const i = times.indexOf(c);
    if (i <= 0) {
      kept.push(c);
      continue;
    }
    let back = -1;
    for (let j = i + 1; j <= Math.min(times.length - 1, i + window); j++) {
      if (histDistance(hists[i - 1], hists[j]) < returnDist) {
        back = j;
        break;
      }
    }
    if (back >= 0) {
      flashes.push(c);
      intervals.push([c, times[back]]);
    } else kept.push(c);
  }
  // the jump back out of a flash is not a cut either
  const inFlash = (t: number) => intervals.some(([s, e]) => t > s && t <= e + 1e-6);
  return { cuts: kept.filter((t) => !inFlash(t)), flashes };
}

/** Cut decision: large histogram jump relative to the local median of jumps. */
export function detectCuts(times: number[], dists: number[], abs = 0.3, rel = 3): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < dists.length; i++) {
    const lo = Math.max(1, i - 5);
    const hi = Math.min(dists.length, i + 6);
    const neigh = dists.slice(lo, hi).filter((_, k) => lo + k !== i).sort((p, q) => p - q);
    const median = neigh.length ? neigh[Math.floor(neigh.length / 2)] : 0;
    if (dists[i] >= abs && dists[i] >= rel * Math.max(median, 0.02)) cuts.push(times[i]);
  }
  return cuts;
}
