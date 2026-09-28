/**
 * Pure signal-processing helpers for audio feature extraction.
 * Everything here runs on mono float PCM at ANALYSIS_RATE and is streaming-friendly,
 * so long podcasts can be processed chunk by chunk without holding the whole file.
 */

export const ANALYSIS_RATE = 16000;
export const FRAME = 512; // 32 ms
export const HOP = 320; // 20 ms -> 50 frames per second
export const FPS = ANALYSIS_RATE / HOP;

/** In-place iterative radix-2 FFT. re/im length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface FrameFeatures {
  /** frame level, dB re full scale */
  db: number[];
  /** half-wave rectified log-spectral flux (onset strength) */
  flux: number[];
  /** zero-crossing rate (crossings per sample) */
  zcr: number[];
  /** cosine similarity of the magnitude spectrum with the previous frame */
  specSim: number[];
  /** spectral flatness (geometric / arithmetic mean), 0..1 */
  flatness: number[];
}

/**
 * Streaming frame analyser. Push arbitrary-length chunks; frames are emitted
 * every HOP samples with FRAME-sample windows.
 */
export class FrameAnalyzer {
  readonly out: FrameFeatures = { db: [], flux: [], zcr: [], specSim: [], flatness: [] };
  private buf = new Float32Array(0);
  private readonly win = new Float64Array(FRAME);
  private prevLogMag: Float64Array | null = null;
  private prevMag: Float64Array | null = null;
  private readonly re = new Float64Array(FRAME);
  private readonly im = new Float64Array(FRAME);

  constructor() {
    for (let i = 0; i < FRAME; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  }

  push(chunk: Float32Array): void {
    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    let pos = 0;
    while (pos + FRAME <= merged.length) {
      this.frame(merged.subarray(pos, pos + FRAME));
      pos += HOP;
    }
    this.buf = merged.slice(pos);
  }

  private frame(x: Float32Array): void {
    let sum = 0;
    let zc = 0;
    for (let i = 0; i < FRAME; i++) {
      sum += x[i] * x[i];
      if (i > 0 && (x[i] >= 0) !== (x[i - 1] >= 0)) zc++;
      this.re[i] = x[i] * this.win[i];
      this.im[i] = 0;
    }
    const rms = Math.sqrt(sum / FRAME);
    this.out.db.push(20 * Math.log10(rms + 1e-9));
    this.out.zcr.push(zc / FRAME);
    fft(this.re, this.im);
    const bins = FRAME / 2;
    const mag = new Float64Array(bins);
    const logMag = new Float64Array(bins);
    let logSum = 0;
    let linSum = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.hypot(this.re[k], this.im[k]);
      mag[k] = m;
      logMag[k] = Math.log(1 + 100 * m);
      logSum += Math.log(m + 1e-12);
      linSum += m;
    }
    const nb = bins - 1;
    this.out.flatness.push(linSum > 1e-9 ? Math.exp(logSum / nb) / (linSum / nb) : 1);
    let flux = 0;
    if (this.prevLogMag) for (let k = 1; k < bins; k++) flux += Math.max(0, logMag[k] - this.prevLogMag[k]);
    this.out.flux.push(flux / nb);
    let sim = 0;
    if (this.prevMag) {
      let dot = 0;
      let na = 0;
      let nb2 = 0;
      for (let k = 1; k < bins; k++) {
        dot += mag[k] * this.prevMag[k];
        na += mag[k] * mag[k];
        nb2 += this.prevMag[k] * this.prevMag[k];
      }
      sim = na > 0 && nb2 > 0 ? dot / Math.sqrt(na * nb2) : 0;
    }
    this.out.specSim.push(sim);
    this.prevLogMag = logMag;
    this.prevMag = mag;
  }
}

export const mean = (xs: ArrayLike<number>, a = 0, b = xs.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += xs[i];
  return b > a ? s / (b - a) : 0;
};

export const std = (xs: ArrayLike<number>, a = 0, b = xs.length) => {
  const m = mean(xs, a, b);
  let s = 0;
  for (let i = a; i < b; i++) s += (xs[i] - m) ** 2;
  return b > a ? Math.sqrt(s / (b - a)) : 0;
};

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

export const SILENCE_DB = -55;

/**
 * Fraction of energy in the 2-8 Hz band of the frame-level amplitude envelope
 * (syllable rate in speech) relative to 0.5-16 Hz.
 */
export function syllabicModulation(db: ArrayLike<number>, a: number, b: number): number {
  const n = 256; // ~5.1 s at 50 fps
  const len = b - a;
  if (len < 32) return 0;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const env: number[] = [];
  for (let i = a; i < b; i++) env.push(Math.pow(10, db[i] / 20));
  const m = mean(env);
  for (let i = 0; i < Math.min(n, env.length); i++) re[i] = env[i] - m;
  fft(re, im);
  let band = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    const hz = (k * FPS) / n;
    const p = re[k] * re[k] + im[k] * im[k];
    if (hz >= 0.5 && hz <= 16) total += p;
    if (hz >= 2 && hz <= 8) band += p;
  }
  return total > 0 ? band / total : 0;
}

export interface WindowClass {
  t: number;
  silent: boolean;
  speech: number;
  music: number;
}

/**
 * Heuristic speech/music scores for 1-second windows (with 2-s context for modulation).
 * These are transparent heuristics, not a trained classifier; outputs are 0..1 scores.
 */
export function classifyWindows(f: FrameFeatures, startIndex = 0, endIndex = f.db.length): WindowClass[] {
  const out: WindowClass[] = [];
  const W = Math.round(FPS);
  for (let a = startIndex; a + W <= endIndex; a += W) {
    const b = a + W;
    const ctxA = Math.max(startIndex, a - W);
    const ctxB = Math.min(endIndex, b + W);
    const dbs = f.db.slice(ctxA, ctxB);
    const active = dbs.filter((x) => x > SILENCE_DB).length / dbs.length;
    if (active < 0.3) {
      out.push({ t: a / FPS, silent: true, speech: 0, music: 0 });
      continue;
    }
    const meanLin = mean(dbs.map((x) => Math.pow(10, x / 20)));
    // low-energy frame ratio: speech has frequent short pauses between syllables/words
    const ler = dbs.filter((x) => Math.pow(10, x / 20) < 0.5 * meanLin).length / dbs.length;
    const mod = syllabicModulation(f.db, ctxA, ctxB);
    const fluxCv = std(f.flux, ctxA, ctxB) / (mean(f.flux, ctxA, ctxB) + 1e-9);
    const zcrStd = std(f.zcr, ctxA, ctxB);
    const sim = mean(f.specSim, ctxA, ctxB);
    const flat = mean(f.flatness, ctxA, ctxB);
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const speech = clamp(
      0.35 * clamp((ler - 0.15) / 0.35) + 0.3 * clamp((mod - 0.35) / 0.35) + 0.2 * clamp((fluxCv - 0.8) / 1.2) + 0.15 * clamp((zcrStd - 0.02) / 0.06),
    );
    const music = clamp(
      0.4 * clamp((sim - 0.75) / 0.2) + 0.25 * clamp((0.25 - ler) / 0.2) + 0.2 * clamp((0.3 - flat) / 0.25) + 0.15 * clamp((0.45 - mod) / 0.3),
    );
    out.push({ t: a / FPS, silent: false, speech, music });
  }
  return out;
}

/** Autocorrelation-based beat periodicity of the onset envelope between 50 and 200 BPM. */
export function beatStrength(flux: ArrayLike<number>, a: number, b: number): { bpm: number; clarity: number } {
  const n = b - a;
  if (n < FPS * 6) return { bpm: 0, clarity: 0 };
  const x: number[] = [];
  const m = mean(flux, a, b);
  for (let i = a; i < b; i++) x.push(flux[i] - m);
  let r0 = 0;
  for (const v of x) r0 += v * v;
  if (r0 <= 1e-12) return { bpm: 0, clarity: 0 };
  const minLag = Math.round((60 / 200) * FPS);
  const maxLag = Math.round((60 / 50) * FPS);
  const r = new Map<number, number>();
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += x[i] * x[i + lag];
    const v = acc / (r0 * ((n - lag) / n));
    r.set(lag, v);
    if (v > best) {
      best = v;
      bestLag = lag;
    }
  }
  // Prefer the beat level over the bar level: if half the lag is also strongly periodic,
  // report the faster tempo (a common octave ambiguity in tempo estimation).
  const half = Math.round(bestLag / 2);
  if (bestLag && (60 * FPS) / bestLag < 80 && half >= minLag && (r.get(half) ?? 0) >= 0.3 * best) bestLag = half;
  return { bpm: bestLag ? (60 * FPS) / bestLag : 0, clarity: Math.max(0, best) };
}

/**
 * Abrupt onsets: the level jumps by >= riseDb above the power-average of the preceding
 * second, reaches that height within ~40 ms, and is at least as loud as the file's typical
 * active level. Returns onset times in seconds.
 */
export function detectAbruptOnsets(db: ArrayLike<number>, riseDb = 20): number[] {
  const out: number[] = [];
  const pre = Math.round(1.0 * FPS);
  const active: number[] = [];
  for (let i = 0; i < db.length; i++) if (db[i] > SILENCE_DB) active.push(db[i]);
  if (!active.length) return out;
  const typical = percentile(active, 50);
  let last = -Infinity;
  for (let i = pre; i < db.length - 2; i++) {
    let p = 0;
    for (let k = i - pre; k < i; k++) p += Math.pow(10, db[k] / 10);
    const beforeDb = 10 * Math.log10(p / pre + 1e-12);
    const peak = Math.max(db[i], db[i + 1]);
    if (peak - beforeDb >= riseDb && peak >= typical && db[i] - db[i - 1] >= riseDb / 2 && i / FPS - last > 1.5) {
      out.push(i / FPS);
      last = i / FPS;
    }
  }
  return out;
}
