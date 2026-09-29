/**
 * Emotion over time, and the brain systems research links to it.
 *
 * 1. Valence (unpleasant..pleasant) and arousal (calm..energetic) every half second, from the audio cues
 *    in features.ts and, when available, the musicnn mood tags. The coefficients come from
 *    scripts/validation/vgmidi_eval.py, fitted to the ratings of real listeners (VGMIDI) and checked on
 *    pieces the fit never saw (the held-out accuracy is kept with the model and shown in the app).
 * 2. Musical events linked to pleasure: build-ups (crescendos), peaks (sudden loudness increases and new
 *    sounds entering) and groove (a clear beat at a danceable tempo).
 * 3. System levels (reward/dopamine, stress, sadness, calm): the findings in data/emotion/systems.json
 *    applied to 1 and 2. These are research-based estimates for a typical listener, not measurements.
 */
import vaModel from '../../data/emotion/valence_arousal.json';
import systemsDoc from '../../data/emotion/systems.json';
import { FPS, SILENCE_DB } from '../analysis/audio/dsp';
import { CUES, LONG_WIN, SHORT_WIN, cuesAt, keyMode, pieceReference, type CueId, type EmotionFrames } from './features';
import type { VisualTimeline } from './visual';

export const STEP = 0.5;
/** Bars that end earlier than this were left out of the fit (raters were still settling), so piece means skip them too. */
const SETTLE = 5;

type ModelInput = { block: string; name: string };
interface DimModel {
  intercept: number;
  mean: number[];
  sd: number[];
  coef: number[];
  heldOut: { r: number; r2: number; pieceR: number; withinR_median: number | null };
  heldOutByGame: { r: number; r2: number; pieceR: number; withinR_median: number | null };
}
interface VAModel {
  inputs: ModelInput[];
  zClip: number;
  valence: DimModel;
  arousal: DimModel;
}
const MODELS = vaModel.models as unknown as Record<'cues' | 'cues+tags', VAModel>;
export const HUMAN_AGREEMENT = vaModel.human;
export const TARGET_SD = vaModel.targetSD;

export const MODEL_CUES: CueId[] = CUES.filter((c) => c !== 'level');
export const MODEL_TAGS = MODELS['cues+tags'].inputs.filter((i) => i.block === 'tags').map((i) => i.name);

export type ModelId = 'cues' | 'cues+tags';

export function modelInfo(id: ModelId | 'none') {
  if (id === 'none') return null;
  const m = MODELS[id];
  const rmse = (d: DimModel, sd: number) => sd * Math.sqrt(Math.max(0, 1 - d.heldOut.r2));
  return {
    id,
    valence: m.valence.heldOut,
    arousal: m.arousal.heldOut,
    valenceByGame: m.valence.heldOutByGame,
    arousalByGame: m.arousal.heldOutByGame,
    /** typical error of one estimate, on the raters' -1..1 scale */
    rmse: { valence: rmse(m.valence, TARGET_SD.valence), arousal: rmse(m.arousal, TARGET_SD.arousal) },
  };
}

export interface TagFrame {
  /** centre of the 3-s patch (s) */
  t: number;
  /** probabilities in `labels` order */
  probs: ArrayLike<number>;
}

export interface EmotionInput {
  duration: number;
  /** 20 ms frame series from FrameAnalyzer */
  db: ArrayLike<number>;
  flux: ArrayLike<number>;
  flatness: ArrayLike<number>;
  frames: EmotionFrames;
  /** abrupt onsets (s), from detectAbruptOnsets */
  onsets?: number[];
  tags?: { labels: string[]; frames: TagFrame[] } | null;
}

export interface EmotionEvent {
  t: number;
  kind: 'peak' | 'buildup' | 'hit';
  strength: number;
}

export interface EmotionTimeline {
  step: number;
  /** 'none' when the file has no audio */
  model: ModelId | 'none';
  /** estimated mean listener rating, -1..1 (raters' scale), per step; 0 during silence. For video, sound and picture combined. */
  valence: number[];
  arousal: number[];
  silent: boolean[];
  /** model inputs per step (cues, then tags), for explanations */
  inputs: number[][];
  /** mean inputs over the file (the model compares each moment with them) */
  pieceMean: number[];
  /** the sound-only estimate (the part checked against listener ratings), when a picture was blended in */
  audio?: { valence: number[]; arousal: number[] };
  /** picture cues (video only) */
  visual?: VisualTimeline;
  bpm: number[];
  /** 0..1 per step */
  peak: number[];
  build: number[];
  groove: number[];
  /** decaying 0..1 impulse after sudden loud onsets */
  startle: number[];
  events: EmotionEvent[];
  /** overall key of the file (Krumhansl-Kessler), for display */
  key: { tonic: number; major: boolean; clarity: number } | null;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Power-mean level (dB) of audible frames in [a, b) seconds; null when silent. */
function levelDb(db: ArrayLike<number>, a: number, b: number): number | null {
  const i0 = Math.max(0, Math.floor(a * FPS));
  const i1 = Math.min(db.length, Math.floor(b * FPS));
  let e = 0;
  let n = 0;
  for (let i = i0; i < i1; i++)
    if (db[i] > SILENCE_DB) {
      e += 10 ** (db[i] / 10);
      n++;
    }
  return n ? 10 * Math.log10(e / n) : null;
}

function audibleShare(db: ArrayLike<number>, a: number, b: number): number {
  const i0 = Math.max(0, Math.floor(a * FPS));
  const i1 = Math.min(db.length, Math.floor(b * FPS));
  let n = 0;
  for (let i = i0; i < i1; i++) if (db[i] > SILENCE_DB) n++;
  return i1 > i0 ? n / (i1 - i0) : 0;
}

/** Power-weighted spectral brightness (log2 of centroid / 1 kHz) in [a, b) seconds. */
function brightness(f: EmotionFrames, a: number, b: number): number | null {
  const i0 = Math.max(0, Math.floor((a * 16000) / 256));
  const i1 = Math.min(f.power.length, Math.floor((b * 16000) / 256));
  let tot = 0;
  let cw = 0;
  for (let i = i0; i < i1; i++) {
    tot += f.power[i];
    cw += f.power[i] * f.centroid[i];
  }
  return tot > 1e-10 ? Math.log2(Math.max(50, cw / tot) / 1000) : null;
}

function tagsAt(frames: TagFrame[], labels: string[], t: number): number[] {
  const idx = MODEL_TAGS.map((n) => labels.indexOf(n));
  let sel = frames.filter((f) => f.t >= t - SHORT_WIN && f.t <= t);
  if (!sel.length && frames.length) {
    let best = frames[0];
    for (const f of frames) if (Math.abs(f.t - (t - SHORT_WIN / 2)) < Math.abs(best.t - (t - SHORT_WIN / 2))) best = f;
    sel = [best];
  }
  return idx.map((k) => {
    let p = 0;
    for (const f of sel) p += k >= 0 ? f.probs[k] : 0;
    p = clamp(p / Math.max(1, sel.length), 1e-6, 1 - 1e-6);
    return Math.log(p / (1 - p));
  });
}

/** Apply one fitted ridge model to raw inputs (the within-song change block is derived here). */
export function predict(model: VAModel, dim: 'valence' | 'arousal', raw: number[], pieceMean: number[]): number {
  const d = model[dim];
  const nc = MODEL_CUES.length;
  const hasTags = model.inputs.length > 2 * nc;
  const nt = hasTags ? MODEL_TAGS.length : 0;
  // layout of the fitted inputs: cues, cue changes, [tags, tag changes]
  const x: number[] = [...raw.slice(0, nc), ...raw.slice(0, nc).map((v, k) => v - pieceMean[k])];
  if (hasTags) x.push(...raw.slice(nc, nc + nt), ...raw.slice(nc, nc + nt).map((v, k) => v - pieceMean[nc + k]));
  let y = d.intercept;
  for (let k = 0; k < x.length; k++) y += d.coef[k] * clamp((x[k] - d.mean[k]) / d.sd[k], -model.zClip, model.zClip);
  return y;
}

/** Per-input contributions (coef x z) to one estimate, grouped by cue or tag name. */
export function contributions(tl: EmotionTimeline, i: number, dim: 'valence' | 'arousal'): { name: string; kind: 'cue' | 'tag'; value: number; high: boolean }[] {
  if (tl.model === 'none' || !tl.inputs[i]) return [];
  const model = MODELS[tl.model];
  const d = model[dim];
  const nc = MODEL_CUES.length;
  const nt = tl.model === 'cues+tags' ? MODEL_TAGS.length : 0;
  const mean = tl.pieceMean;
  const raw = tl.inputs[i];
  const x: number[] = [...raw.slice(0, nc), ...raw.slice(0, nc).map((v, k) => v - mean[k])];
  if (nt) x.push(...raw.slice(nc, nc + nt), ...raw.slice(nc, nc + nt).map((v, k) => v - mean[nc + k]));
  const out = new Map<string, { name: string; kind: 'cue' | 'tag'; value: number; high: boolean }>();
  model.inputs.forEach((inp, k) => {
    const z = clamp((x[k] - d.mean[k]) / d.sd[k], -model.zClip, model.zClip);
    const kind = inp.block.startsWith('tag') ? 'tag' : 'cue';
    const key = `${kind}:${inp.name}`;
    // "high" = the input itself is above what is typical in the rated music
    const cur = out.get(key) ?? { name: inp.name, kind, value: 0, high: z > 0 };
    cur.value += d.coef[k] * z;
    out.set(key, cur);
  });
  return [...out.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function pieceMeans(inputs: number[][], silent: boolean[], step: number): number[] {
  return meanRows(inputs, inputs.map((_, i) => !silent[i] && (i * step >= SETTLE || inputs.length * step < 2 * SETTLE)));
}

function meanRows(rows: number[][], keep: boolean[]): number[] {
  const n = rows[0]?.length ?? 0;
  const s = new Array(n).fill(0);
  let c = 0;
  rows.forEach((r, i) => {
    if (!keep[i]) return;
    for (let k = 0; k < n; k++) s[k] += r[k];
    c++;
  });
  if (!c) return rows.length ? meanRows(rows, rows.map(() => true)) : s;
  return s.map((v) => v / c);
}

export function buildEmotion(inp: EmotionInput): EmotionTimeline {
  const n = Math.max(1, Math.floor(inp.duration / STEP) + 1);
  const ref = pieceReference(inp.db);
  const cueIn = { db: inp.db, flux: inp.flux, flatness: inp.flatness, frames: inp.frames, pieceRef: ref };
  const useTags = !!inp.tags?.frames.length;
  const model: ModelId = useTags ? 'cues+tags' : 'cues';
  const inputs: number[][] = [];
  const bpm: number[] = [];
  const silent: boolean[] = [];
  const groove: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    const c = cuesAt(cueIn, t);
    const row = MODEL_CUES.map((k) => c[k as CueId]);
    if (useTags) row.push(...tagsAt(inp.tags!.frames, inp.tags!.labels, t));
    inputs.push(row);
    bpm.push(c.pulse > 0.05 ? c.bpm : 0);
    silent.push(audibleShare(inp.db, t - 2, t) < 0.2);
    // groove: a clear pulse at a tempo people like to move to (roughly 90-140 BPM)
    const tempoFit = c.bpm > 0 ? Math.exp(-(((c.bpm - 115) / 35) ** 2)) : 0;
    groove.push(clamp01(c.pulse / 0.5) * tempoFit);
  }
  const mean = pieceMeans(inputs, silent, STEP);
  const tl: EmotionTimeline = { step: STEP, model, valence: [], arousal: [], silent, inputs, pieceMean: mean, bpm, peak: [], build: [], groove, startle: [], events: [], key: null };
  const M = MODELS[model];
  for (let i = 0; i < n; i++) {
    tl.valence.push(silent[i] ? 0 : predict(M, 'valence', inputs[i], mean));
    tl.arousal.push(silent[i] ? 0 : predict(M, 'arousal', inputs[i], mean));
  }

  // --- musical events associated with chills and pleasure (de Fleurian & Pearce 2021; Grewe et al. 2007) ---
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    const now = levelDb(inp.db, t - 0.5, t);
    const before = levelDb(inp.db, t - 3, t - 0.5);
    const recent = levelDb(inp.db, t - 1, t);
    const earlier = levelDb(inp.db, t - 6, t - 5);
    // sudden increase in loudness (a "hit", drop or entry)
    const surge = now !== null ? clamp01((now - (before ?? now - 12) - 3) / 9) : 0;
    // crescendo: louder now than five seconds ago
    const build = recent !== null && earlier !== null ? clamp01((recent - earlier - 2) / 10) : 0;
    // new sound colour (e.g. instruments entering)
    const b1 = brightness(inp.frames, t - 1, t);
    const b0 = brightness(inp.frames, t - 5, t - 1);
    const novelty = b1 !== null && b0 !== null ? clamp01((Math.abs(b1 - b0) - 0.25) / 0.75) : 0;
    const loudEnough = now !== null ? clamp01((now - ref + 14) / 8) : 0;
    tl.peak.push(silent[i] ? 0 : loudEnough * clamp01(0.75 * surge + 0.35 * novelty));
    tl.build.push(silent[i] ? 0 : build);
  }
  // sudden loud onsets (startle) as a decaying impulse
  const onsets = [...(inp.onsets ?? [])].sort((a, b) => a - b);
  for (let i = 0, k = -1; i < n; i++) {
    const t = i * STEP;
    while (k + 1 < onsets.length && onsets[k + 1] <= t) k++;
    tl.startle.push(k >= 0 ? Math.exp(-(t - onsets[k]) / 1.2) : 0);
  }
  tl.events = [...pickEvents(tl.peak, 0.35, 6, 'peak'), ...pickEvents(tl.build, 0.4, 8, 'buildup'), ...onsets.map((t) => ({ t, kind: 'hit' as const, strength: 1 }))].sort(
    (a, b) => a.t - b.t,
  );
  tl.key = overallKey(inp.frames);
  return tl;
}

/** A timeline for files without audio: everything silent until picture cues are added. */
export function silentTimeline(duration: number): EmotionTimeline {
  const n = Math.max(1, Math.floor(duration / STEP) + 1);
  const zeros = () => new Array(n).fill(0);
  return {
    step: STEP,
    model: 'none',
    valence: zeros(),
    arousal: zeros(),
    silent: new Array(n).fill(true),
    inputs: [],
    pieceMean: [],
    bpm: zeros(),
    peak: zeros(),
    build: zeros(),
    groove: zeros(),
    startle: zeros(),
    events: [],
    key: null,
  };
}

/**
 * Blend in the picture. The sound estimate (checked against listener ratings) counts fully and the
 * picture cues (not checked; small by design) add half their value; with no sound, the picture alone.
 */
export function withVisual(tl: EmotionTimeline, vis: VisualTimeline): EmotionTimeline {
  const audio = { valence: tl.valence, arousal: tl.arousal };
  const valence: number[] = [];
  const arousal: number[] = [];
  for (let i = 0; i < tl.valence.length; i++) {
    const vv = vis.valence[i] ?? 0;
    const va = vis.arousal[i] ?? 0;
    valence.push(tl.silent[i] ? vv : audio.valence[i] + 0.5 * vv);
    arousal.push(tl.silent[i] ? va : audio.arousal[i] + 0.5 * va);
  }
  return { ...tl, valence, arousal, silent: tl.valence.map(() => false), audio, visual: vis };
}

function pickEvents(x: number[], thr: number, minGap: number, kind: 'peak' | 'buildup'): EmotionEvent[] {
  const cand = x.map((v, i) => ({ i, v })).filter(({ i, v }) => v >= thr && v >= (x[i - 1] ?? 0) && v >= (x[i + 1] ?? 0));
  cand.sort((a, b) => b.v - a.v);
  const out: EmotionEvent[] = [];
  for (const c of cand) if (out.every((e) => Math.abs(e.t - c.i * STEP) >= minGap)) out.push({ t: c.i * STEP, kind, strength: Math.round(c.v * 100) / 100 });
  return out;
}

function overallKey(f: EmotionFrames): EmotionTimeline['key'] {
  if (!f.chroma.length) return null;
  const c = new Float64Array(12);
  for (const fr of f.chroma) for (let k = 0; k < 12; k++) c[k] += fr[k];
  const km = keyMode(c);
  return km.clarity > 0 ? { tonic: km.key, major: km.major, clarity: km.clarity } : null;
}

// ------------------------------------------------------------------------------------ labels

export interface EmotionLabel {
  id: 'joyful' | 'energetic' | 'tense' | 'uneasy' | 'sad' | 'subdued' | 'calm' | 'pleasant' | 'neutral' | 'silence';
  name: string;
  /** one short plain-language line */
  hint: string;
}

const LABELS: Record<EmotionLabel['id'], Omit<EmotionLabel, 'id'>> = {
  joyful: { name: 'Joyful / upbeat', hint: 'Pleasant and energetic' },
  energetic: { name: 'Energetic', hint: 'High energy, neither clearly happy nor dark' },
  tense: { name: 'Tense / anxious', hint: 'Dark and energetic - like suspense, anger or fear' },
  uneasy: { name: 'Dark / uneasy', hint: 'Unpleasant but not especially energetic' },
  sad: { name: 'Sad / melancholic', hint: 'Dark and low in energy' },
  subdued: { name: 'Subdued', hint: 'Low energy, neither clearly happy nor sad' },
  calm: { name: 'Calm / peaceful', hint: 'Pleasant and low in energy' },
  pleasant: { name: 'Warm / pleasant', hint: 'Pleasant, moderate energy' },
  neutral: { name: 'Neutral', hint: 'No clear emotional direction' },
  silence: { name: 'Silence', hint: 'Nothing audible' },
};

/** Russell's circumplex (1980) cut into eight sectors; values within 0.1 of the centre are neutral. */
export function emotionLabel(v: number, a: number, silentNow = false): EmotionLabel {
  let id: EmotionLabel['id'];
  if (silentNow) id = 'silence';
  else if (Math.hypot(v, a) < 0.1) id = 'neutral';
  else {
    const deg = ((Math.atan2(a, v) * 180) / Math.PI + 360) % 360;
    const sectors: EmotionLabel['id'][] = ['pleasant', 'joyful', 'energetic', 'tense', 'uneasy', 'sad', 'subdued', 'calm'];
    id = sectors[Math.round(deg / 45) % 8];
  }
  return { id, ...LABELS[id] };
}

// ------------------------------------------------------------------------------------ systems

export type SystemId = 'reward' | 'stress' | 'sadness' | 'calm';
export interface SystemInfo {
  id: SystemId;
  name: string;
  chemicals: string;
  color: string;
  grade: string;
  summary: string;
  drivers: string[];
  regions: { region: string; part: string; role: string; sources: string[] }[];
  evidence: { source: string; says: string }[];
  caveats: string[];
}
export const SYSTEMS = systemsDoc.systems as SystemInfo[];
export const NOT_ESTIMATED = systemsDoc.notEstimated;

/** How much the listener enjoys the music scales the reward system (Ferreri et al. 2019; Mas-Herrero et al. 2014). */
export type Liking = 'yes' | 'unsure' | 'no';
export const LIKING_GAIN: Record<Liking, number> = { yes: 1, unsure: 0.7, no: 0.2 };

export interface SystemState {
  level: Record<SystemId, number>;
  /** 0..1 per region id and part (e.g. reward.accumbens_area), before colouring */
  parts: { system: SystemId; region: string; value: number }[];
}

/** Valence/arousal on the raters' scale to 0..1 strengths, with a small dead zone around neutral. */
const pos = (x: number) => clamp01((x - 0.05) / 0.35);

/** Decaying memory of recent peaks: pleasure at a peak outlasts the instant itself. */
function recentPeak(tl: EmotionTimeline, i: number): number {
  let best = 0;
  for (let k = Math.max(0, i - Math.round(3 / tl.step)); k <= i; k++) best = Math.max(best, tl.peak[k] * Math.exp(-((i - k) * tl.step) / 1.5));
  return best;
}

export function systemsAt(tl: EmotionTimeline, i: number, liking: Liking): SystemState {
  i = clamp(Math.round(i), 0, tl.valence.length - 1);
  const v = tl.valence[i];
  const a = tl.arousal[i];
  const quiet = tl.silent[i];
  const P = pos(v);
  const N = pos(-v);
  const H = pos(a);
  const L = pos(-a);
  const gain = LIKING_GAIN[liking];
  const peak = recentPeak(tl, i);
  const build = tl.build[i];
  const groove = tl.groove[i];
  const startle = tl.startle[i];
  // seeing fearful or angry faces engages the amygdala (Fusar-Poli et al. 2009)
  const threatFace = tl.visual?.threatFace[i] ?? 0;
  const cue = (name: string) => tl.inputs[i]?.[MODEL_CUES.indexOf(name as CueId)] ?? 0;
  const cm = tl.model === 'none' ? null : MODELS[tl.model].valence; // standardisation of the cue block (same for both dimensions)
  const z = (name: string) => {
    const k = MODEL_CUES.indexOf(name as CueId);
    return k < 0 || !cm || !tl.inputs[i] ? 0 : (cue(name) - cm.mean[k]) / cm.sd[k];
  };
  const harsh = Math.max(clamp01((z('flatness') - 1) / 2), clamp01((z('dissonance') - 1.5) / 2) * N);
  const bpm = tl.bpm[i];
  const tense = Math.sqrt(N * H);
  const sad = Math.sqrt(N * L);
  const calm = Math.sqrt(P * L);
  const fastBody = H * clamp01((bpm - 100) / 60);

  const parts: SystemState['parts'] = [];
  const add = (system: SystemId, region: string, value: number) => parts.push({ system, region, value: quiet ? 0 : clamp01(value) });
  // reward: peak pleasure (accumbens), anticipation (caudate), groove (putamen), valuation (mOFC), dopamine source (midbrain)
  const nacc = gain * clamp01(0.55 * P + 0.7 * peak + 0.2 * groove);
  const caud = gain * clamp01(0.8 * build + 0.25 * groove + 0.2 * P);
  add('reward', 'accumbens_area', nacc);
  add('reward', 'caudate', caud);
  add('reward', 'putamen', gain * clamp01(0.8 * groove + 0.2 * P));
  add('reward', 'medial_orbitofrontal', gain * clamp01(0.6 * P + 0.4 * peak));
  add('reward', 'brainstem', 0.8 * Math.max(nacc, caud));
  // stress: threat and unpleasantness (amygdala, hippocampal region), hormone control (hypothalamus, extrapolated)
  add('stress', 'amygdala', 0.7 * tense + 0.5 * startle + 0.25 * harsh + 0.5 * threatFace);
  add('stress', 'hippocampus', 0.4 * tense + 0.35 * harsh);
  add('stress', 'parahippocampal', 0.35 * tense + 0.4 * harsh);
  add('stress', 'ventral_diencephalon', 0.7 * (0.6 * tense + 0.3 * startle));
  // sadness: hippocampus and amygdala
  add('sadness', 'hippocampus', 0.7 * sad);
  add('sadness', 'amygdala', 0.5 * sad);

  const level: Record<SystemId, number> = quiet
    ? { reward: 0, stress: 0, sadness: 0, calm: 0 }
    : {
        reward: gain * clamp01(0.5 * P + 0.5 * peak + 0.25 * groove + 0.3 * build * (0.5 + 0.5 * P)),
        stress: clamp01(0.65 * tense + 0.3 * startle + 0.2 * harsh + 0.15 * fastBody + 0.3 * threatFace),
        sadness: clamp01(sad),
        calm: clamp01(calm),
      };
  return { level, parts };
}

const hex = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255) as [number, number, number];
const SYSTEM_RGB = Object.fromEntries(SYSTEMS.map((s) => [s.id, hex(s.color)])) as Record<SystemId, [number, number, number]>;
export const systemById = (id: SystemId) => SYSTEMS.find((s) => s.id === id)!;

/** Region id -> mesh ids, supplied by the caller (from the evidence database). */
export type MeshesOf = (region: string) => string[];

/** Per-mesh intensity (0..1) and colour: systems sharing an area blend by their strength. */
export function meshColours(state: SystemState, meshesOf: MeshesOf, out: Map<string, { v: number; rgb: [number, number, number] }>) {
  out.clear();
  const acc = new Map<string, { keep: number; r: number; g: number; b: number; w: number }>();
  for (const p of state.parts) {
    if (p.value <= 0.01) continue;
    const [r, g, b] = SYSTEM_RGB[p.system];
    for (const m of meshesOf(p.region)) {
      const cur = acc.get(m) ?? { keep: 1, r: 0, g: 0, b: 0, w: 0 };
      cur.keep *= 1 - p.value;
      cur.r += r * p.value;
      cur.g += g * p.value;
      cur.b += b * p.value;
      cur.w += p.value;
      acc.set(m, cur);
    }
  }
  for (const [m, c] of acc) out.set(m, { v: 1 - c.keep, rgb: [c.r / c.w, c.g / c.w, c.b / c.w] });
  return out;
}

export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** How each input reads when it is above / below typical, for "why" explanations. */
export const INPUT_PHRASES: Record<string, [string, string]> = {
  level_rel: ['loud for this track', 'quiet for this track'],
  level_var: ['big swings in loudness', 'steady loudness'],
  onset_rate: ['many notes and hits', 'few notes and hits'],
  flux: ['a lot going on in the sound', 'little change in the sound'],
  tempo: ['fast tempo', 'slow tempo'],
  pulse: ['a clear, steady beat', 'no clear beat'],
  brightness: ['bright sound', 'dark, mellow sound'],
  flatness: ['noisy, harsh sound', 'clean, tonal sound'],
  mode: ['major-sounding harmony', 'minor-sounding harmony'],
  key_clarity: ['clear, simple harmony', 'complex or unclear harmony'],
  dissonance: ['clashing notes', 'few clashing notes'],
};
export function inputPhrase(c: { name: string; kind: 'cue' | 'tag'; high: boolean }): string {
  if (c.kind === 'tag') return c.high ? `sounds like music people tag "${c.name.toLowerCase()}"` : `sounds unlike music people tag "${c.name.toLowerCase()}"`;
  const p = INPUT_PHRASES[c.name];
  return p ? p[c.high ? 0 : 1] : c.name;
}


export const WINDOWS = { short: SHORT_WIN, long: LONG_WIN };
