/**
 * Browser side of the emotion analysis: loads the musicnn tagger (reusing the TensorFlow.js copy that
 * ships with face-api, on WebGL when the device has it) and tags the log-mel patches collected while
 * the audio was decoded. Everything runs locally; nothing is uploaded.
 */
import { fetchBinary } from '../util/hosted';
import type { TagFrame } from './model';
import { PATCH_FRAMES, buildMusicnn, melPatches, type Musicnn, type MusicnnManifest } from './musicnn';

const BASE = './models/musicnn';
/** ~1.5 s between patches (the hop used when the model was checked against listener ratings) */
export const PATCH_HOP = 94;
/** Log-mel frames kept for tagging (16 ms each): 20 minutes. Longer files use the cue-only model. */
export const MAX_MEL_FRAMES = Math.round((20 * 60 * 16000) / 256);

export async function loadMelFilters(): Promise<Float32Array | null> {
  try {
    return new Float32Array(await fetchBinary(`${BASE}/mel_filters.bin`));
  } catch {
    return null;
  }
}

/** Tagging stops after this long (once at least MIN_WINDOWS are done), so slow devices are not held up. */
const BUDGET_MS = 20000;
const MIN_WINDOWS = 6;

/** Indices 0..n-1 ordered coarse to fine: every 16th, then the ones halfway between, and so on. */
export function coarseToFine(n: number): number[] {
  const out: number[] = [];
  const seen = new Uint8Array(n);
  for (let stride = 16; stride >= 1; stride = stride >> 1)
    for (let k = 0; k < n; k += stride)
      if (!seen[k]) {
        seen[k] = 1;
        out.push(k);
      }
  return out;
}

let loading: Promise<{ model: Musicnn; gpu: boolean }> | null = null;

async function loadTagger(): Promise<{ model: Musicnn; gpu: boolean }> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const tf = faceapi.tf as unknown as Parameters<typeof buildMusicnn>[0] & { setBackend(b: string): Promise<boolean>; getBackend(): string };
      if (tf.getBackend() !== 'webgl') {
        const ok = await tf.setBackend('webgl').catch(() => false);
        if (!ok) await tf.setBackend('cpu');
      }
      await tf.ready();
      const res = await fetch(`${BASE}/manifest.json`);
      if (!res.ok) throw new Error(`Could not load the music tagger (HTTP ${res.status}).`);
      const manifest = (await res.json()) as MusicnnManifest;
      const weights = await fetchBinary(`${BASE}/weights.bin`);
      return { model: buildMusicnn(tf, manifest, weights), gpu: tf.getBackend() === 'webgl' };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface TagResult {
  labels: string[];
  frames: TagFrame[];
  note: string;
}

/** Run the tagger over the file's log-mel frames. Returns null (and the reason) if it cannot run here. */
export async function tagMusic(
  logmel: Float32Array[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<TagResult | { labels: null; note: string }> {
  let tagger: { model: Musicnn; gpu: boolean };
  try {
    tagger = await loadTagger();
  } catch (e) {
    return { labels: null, note: `The music mood tagger could not be loaded (${(e as Error).message}); emotion uses the audio cues only.` };
  }
  // Coarse to fine: first a few windows spread over the whole track, then the gaps between them,
  // until every window is tagged or the time budget runs out (slow devices keep a coarser set;
  // moments without a window of their own use the nearest one).
  const patches = melPatches(logmel, PATCH_HOP, 400);
  const order = coarseToFine(patches.length);
  const frames: TagFrame[] = [];
  const batch = tagger.gpu ? 8 : 2;
  const started = performance.now();
  let done = 0;
  for (let i = 0; i < order.length; i += batch) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    if (done >= MIN_WINDOWS && performance.now() - started > BUDGET_MS) break;
    const part = order.slice(i, i + batch).map((k) => patches[k]);
    const probs = await tagger.model.predict(part.map((p) => p.patch));
    part.forEach((p, k) => frames.push({ t: ((p.start + PATCH_FRAMES / 2) * 256) / 16000, probs: Array.from(probs[k]) }));
    done += part.length;
    onProgress(Math.min(1, Math.max(done / order.length, (performance.now() - started) / BUDGET_MS)));
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  frames.sort((a, b) => a.t - b.t);
  return {
    labels: tagger.model.labels,
    frames,
    note:
      frames.length < patches.length
        ? `Music mood tagger (musicnn) ran locally on ${frames.length} of ${patches.length} three-second windows spread over the track (time limit on this device; the rest use the nearest window).`
        : `Music mood tagger (musicnn) ran locally on all ${frames.length} three-second windows.`,
  };
}
