/**
 * Emotion cues from audio - the same definitions as scripts/validation/emotion_features.py, which was
 * used to check them against listener ratings (tests/emotion-features.test.ts compares the two).
 *
 * Streaming: push the same 16 kHz mono chunks the FrameAnalyzer gets, then finish().
 *  - a centred 512-point STFT every 256 samples (16 ms): spectral centroid and power, and
 *    optionally the 96-band log-mel spectrogram the musicnn tagger was trained on
 *  - a centred 4096-point STFT every 2048 samples (128 ms): 12-bin chroma for key/mode and dissonance
 */
import { ANALYSIS_RATE, FPS, SILENCE_DB, fft, mean } from '../analysis/audio/dsp';

const SR = ANALYSIS_RATE;
export const SHORT_WIN = 4; // s before a moment: the moment plus the lead-in listeners integrate over
export const LONG_WIN = 8; // s for tempo and key

/** Krumhansl & Kessler (1982) key profiles, starting at the tonic. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function periodicHann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/**
 * Centred STFT over a stream: frame i covers samples [i*hop - n/2, i*hop + n/2), zeros outside the signal,
 * and there are 1 + floor(length / hop) frames (librosa's center=True with constant padding).
 */
class CentredStft {
  private buf: Float32Array;
  private start = 0; // absolute sample index (in the zero-padded stream) of buf[0]
  private frames = 0;
  private total = 0;
  private readonly win: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(
    readonly n: number,
    readonly hop: number,
    private readonly onFrame: (power: Float64Array) => void,
  ) {
    this.buf = new Float32Array(n / 2); // the leading half-window of zeros
    this.win = periodicHann(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }

  push(x: Float32Array) {
    this.total += x.length;
    const merged = new Float32Array(this.buf.length + x.length);
    merged.set(this.buf);
    merged.set(x, this.buf.length);
    this.buf = merged;
    this.drain();
  }

  finish() {
    const need = 1 + Math.floor(this.total / this.hop);
    const tail = new Float32Array(this.buf.length + this.n);
    tail.set(this.buf);
    this.buf = tail;
    while (this.frames < need) this.emit(this.frames * this.hop - this.start);
  }

  private drain() {
    while (this.frames * this.hop - this.start + this.n <= this.buf.length) this.emit(this.frames * this.hop - this.start);
    const keep = this.frames * this.hop - this.start;
    if (keep > 0) {
      this.buf = this.buf.slice(keep);
      this.start += keep;
    }
  }

  private emit(at: number) {
    const { n, re, im, win, buf } = this;
    for (let i = 0; i < n; i++) {
      re[i] = (at + i < buf.length ? buf[at + i] : 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const p = new Float64Array(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    this.frames++;
    this.onFrame(p);
  }
}

export interface EmotionFrames {
  /** 16 ms frames */
  centroid: Float32Array;
  power: Float32Array;
  /** 128 ms frames, 12 pitch classes each (C = 0) */
  chroma: Float32Array[];
  dissonance: Float32Array;
  /** 16 ms frames x 96 mel bands, log10(10000 * mel + 1); only when a mel filterbank was given */
  logmel: Float32Array[] | null;
}

export class EmotionFrameAnalyzer {
  private readonly centroid: number[] = [];
  private readonly power: number[] = [];
  private readonly chroma: Float32Array[] = [];
  private readonly logmel: Float32Array[] | null;
  private readonly small: CentredStft;
  private readonly large: CentredStft;

  /** melFilters: 96 x 257 row-major (public/models/musicnn/mel_filters.bin); omit to skip the log-mel. */
  constructor(private readonly melFilters?: Float32Array, maxMelFrames = Infinity) {
    this.logmel = melFilters ? [] : null;
    this.small = new CentredStft(512, 256, (p) => {
      let tot = 0;
      let w = 0;
      for (let k = 1; k <= 256; k++) {
        tot += p[k];
        w += p[k] * ((k * SR) / 512);
      }
      this.power.push(tot);
      this.centroid.push(tot > 1e-10 ? w / Math.max(tot, 1e-20) : 0);
      if (this.logmel && this.melFilters && this.logmel.length < maxMelFrames) {
        const m = new Float32Array(96);
        for (let b = 0; b < 96; b++) {
          let s = 0;
          const row = b * 257;
          for (let k = 0; k < 257; k++) s += this.melFilters[row + k] * p[k];
          m[b] = Math.log10(10000 * s + 1);
        }
        this.logmel.push(m);
      }
    });
    const pcOf = new Int8Array(2049).fill(-1);
    for (let k = 0; k <= 2048; k++) {
      const f = (k * SR) / 4096;
      if (f >= 55 && f <= 2093) pcOf[k] = (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12;
    }
    this.large = new CentredStft(4096, 2048, (p) => {
      const c = new Float32Array(12);
      for (let k = 0; k <= 2048; k++) if (pcOf[k] >= 0) c[pcOf[k]] += Math.sqrt(p[k]);
      this.chroma.push(c);
    });
  }

  push(x: Float32Array) {
    this.small.push(x);
    this.large.push(x);
  }

  finish(): EmotionFrames {
    this.small.finish();
    this.large.finish();
    return {
      centroid: Float32Array.from(this.centroid),
      power: Float32Array.from(this.power),
      chroma: this.chroma,
      dissonance: Float32Array.from(this.chroma, dissonance),
      logmel: this.logmel,
    };
  }
}

/** Share of simultaneous pitch-class energy in sharp clashes: semitones fully, tritones half. */
export function dissonance(c: ArrayLike<number>): number {
  let tot = 0;
  let clash = 0;
  for (let i = 0; i < 12; i++) {
    tot += c[i];
    clash += c[i] * c[(i + 1) % 12] + 0.5 * c[i] * c[(i + 6) % 12];
  }
  return tot > 1e-9 ? clash / Math.max(tot * tot, 1e-18) : 0;
}

function corr(a: ArrayLike<number>, b: ArrayLike<number>, n = 12): number {
  const ma = mean(a, 0, n);
  const mb = mean(b, 0, n);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  const d = Math.sqrt(aa * bb);
  return d > 0 ? ab / d : 0;
}

export interface KeyMode {
  /** best major correlation minus best minor correlation: > 0 sounds major, < 0 minor */
  mode: number;
  /** best correlation of either kind: how clearly one key is implied */
  clarity: number;
  /** tonic pitch class, C = 0 */
  key: number;
  major: boolean;
}

/** Krumhansl-Kessler key finding on a summed 12-bin chroma. */
export function keyMode(c: ArrayLike<number>): KeyMode {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += c[i];
  if (sum <= 1e-9) return { mode: 0, clarity: 0, key: 0, major: true };
  let bMaj = -Infinity;
  let kMaj = 0;
  let bMin = -Infinity;
  let kMin = 0;
  const rolled = new Float64Array(12);
  for (let k = 0; k < 12; k++) {
    for (let i = 0; i < 12; i++) rolled[i] = MAJOR[(((i - k) % 12) + 12) % 12];
    const rj = corr(c, rolled);
    if (rj > bMaj) [bMaj, kMaj] = [rj, k];
    for (let i = 0; i < 12; i++) rolled[i] = MINOR[(((i - k) % 12) + 12) % 12];
    const rn = corr(c, rolled);
    if (rn > bMin) [bMin, kMin] = [rn, k];
  }
  const major = bMaj >= bMin;
  return { mode: bMaj - bMin, clarity: Math.max(bMaj, bMin), key: major ? kMaj : kMin, major };
}

/** Onset strength below this is not a note or hit (steady sounds only jitter below it). */
const ONSET_FLOOR = 0.05;

/** Onsets per second: local peaks of the onset strength above mean + 1 SD of the window (and ONSET_FLOOR), >= 100 ms apart. */
export function onsetRate(flux: ArrayLike<number>, a: number, b: number): number {
  b = Math.min(b, flux.length);
  const n = b - a;
  if (n < 3) return 0;
  const m = mean(flux, a, b);
  let v = 0;
  for (let i = a; i < b; i++) v += (flux[i] - m) ** 2;
  const thr = Math.max(m + Math.sqrt(v / n), ONSET_FLOOR);
  let count = 0;
  let last = -10;
  for (let i = 1; i < n - 1; i++) {
    const x = flux[a + i];
    if (x > thr && x >= flux[a + i - 1] && x > flux[a + i + 1] && i - last >= 5) {
      count++;
      last = i;
    }
  }
  return count / (n / FPS);
}

/** Tempo periodicity of the onset envelope (same as beatStrength in dsp.ts, clamped to the data). */
export function beatStrengthClamped(flux: ArrayLike<number>, a: number, b: number): { bpm: number; clarity: number } {
  b = Math.min(b, flux.length);
  const n = b - a;
  if (n < FPS * 6) return { bpm: 0, clarity: 0 };
  const m = mean(flux, a, b);
  const x = new Float64Array(n);
  let r0 = 0;
  for (let i = 0; i < n; i++) {
    x[i] = flux[a + i] - m;
    r0 += x[i] * x[i];
  }
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
    if (v > best) [best, bestLag] = [v, lag];
  }
  const half = Math.round(bestLag / 2);
  if (bestLag && (60 * FPS) / bestLag < 80 && half >= minLag && (r.get(half) ?? 0) >= 0.3 * best) bestLag = half;
  return { bpm: bestLag ? (60 * FPS) / bestLag : 0, clarity: Math.max(0, best) };
}

export const CUES = ['level', 'level_rel', 'level_var', 'onset_rate', 'flux', 'tempo', 'pulse', 'brightness', 'flatness', 'mode', 'key_clarity', 'dissonance'] as const;
export type CueId = (typeof CUES)[number];
export type Cues = Record<CueId, number> & { bpm: number; key: number; major: boolean };

export interface CueInputs {
  /** 20 ms frame series from FrameAnalyzer */
  db: ArrayLike<number>;
  flux: ArrayLike<number>;
  flatness: ArrayLike<number>;
  frames: EmotionFrames;
  /** 95th percentile of audible frame levels in the whole file (dB) */
  pieceRef: number;
}

const trunc = (x: number) => Math.max(0, Math.trunc(x));

/** 95th percentile of audible frame levels: the reference for loudness relative to the file. */
export function pieceReference(db: ArrayLike<number>): number {
  const aud: number[] = [];
  for (let i = 0; i < db.length; i++) if (db[i] > SILENCE_DB) aud.push(db[i]);
  if (!aud.length) return -20;
  aud.sort((a, b) => a - b);
  // numpy.percentile (linear interpolation)
  const pos = 0.95 * (aud.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(aud.length - 1, lo + 1);
  return aud[lo] + (aud[hi] - aud[lo]) * (pos - lo);
}

/** The emotion cues for the audio just before time tEnd (s). */
export function cuesAt(inp: CueInputs, tEnd: number): Cues {
  const fa = trunc((tEnd - SHORT_WIN) * FPS);
  const fb = Math.max(1, trunc(tEnd * FPS));
  const la = trunc((tEnd - LONG_WIN) * FPS);
  let e = 0;
  let n = 0;
  const aud: number[] = [];
  for (let i = fa; i < Math.min(fb, inp.db.length); i++)
    if (inp.db[i] > SILENCE_DB) {
      aud.push(inp.db[i]);
      e += 10 ** (inp.db[i] / 10);
      n++;
    }
  const level = n ? 10 * Math.log10(e / n) : -60;
  let levelVar = 0;
  if (n > 1) {
    const m = mean(aud);
    levelVar = Math.sqrt(aud.reduce((s, x) => s + (x - m) ** 2, 0) / n);
  }
  const { bpm, clarity } = beatStrengthClamped(inp.flux, la, fb);
  const sa = trunc((tEnd - SHORT_WIN) * (SR / 256));
  const sb = Math.max(1, trunc(tEnd * (SR / 256)));
  let tot = 0;
  let cw = 0;
  const F = inp.frames;
  for (let i = sa; i < Math.min(sb, F.power.length); i++) {
    tot += F.power[i];
    cw += F.power[i] * F.centroid[i];
  }
  const brightness = tot > 1e-10 ? Math.log2(Math.max(50, cw / tot) / 1000) : 0;
  const ca = trunc((tEnd - LONG_WIN) * (SR / 2048));
  const cb = Math.max(1, trunc(tEnd * (SR / 2048)));
  const csum = new Float64Array(12);
  for (let i = ca; i < Math.min(cb, F.chroma.length); i++) for (let k = 0; k < 12; k++) csum[k] += F.chroma[i][k];
  const km = keyMode(csum);
  const da = trunc((tEnd - SHORT_WIN) * (SR / 2048));
  const fbF = Math.min(fb, inp.flux.length);
  return {
    level,
    level_rel: level - inp.pieceRef,
    level_var: levelVar,
    onset_rate: onsetRate(inp.flux, fa, fb),
    flux: mean(inp.flux, fa, fbF),
    tempo: bpm > 0 && clarity > 0.05 ? Math.log2(bpm / 100) : 0,
    pulse: clarity,
    brightness,
    flatness: mean(inp.flatness, fa, Math.min(fb, inp.flatness.length)),
    mode: km.mode,
    key_clarity: km.clarity,
    dissonance: mean(F.dissonance, da, Math.min(cb, F.dissonance.length)),
    bpm,
    key: km.key,
    major: km.major,
  };
}
