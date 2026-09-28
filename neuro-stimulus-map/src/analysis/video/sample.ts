import { detectCuts, estimateMotion, histDistance, separateFlashes, summarize, type FrameSummary } from './frameStats';
import { detectFaces, loadFaceDetector } from './faces';
import type { VideoAnalysis, VideoSample } from './types';

const SUMMARY_W = 96;
const FACE_W = 320;

export function sampleStep(duration: number): number {
  if (duration <= 20 * 60) return 0.5;
  if (duration <= 60 * 60) return 1;
  return 2;
}

const OPEN_ERROR =
  'This browser could not open the file. Its codecs may not be supported here (for example, some Chromium builds lack H.264/AAC for MP4/MOV). Try Chrome, Edge, Safari or Firefox, or convert to WebM, MP3 or WAV.';

/**
 * A muted, inline, off-screen <video> attached to the document. iOS Safari only decodes
 * frames for inline, muted media that is in the DOM, and ignores preload hints until
 * playback has started once.
 */
function hiddenVideo(url: string, preload: 'metadata' | 'auto'): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.preload = preload;
  Object.assign(v.style, { position: 'fixed', left: '-4px', top: '-4px', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  v.src = url;
  document.body.appendChild(v);
  return v;
}

function disposeVideo(v: HTMLVideoElement) {
  v.pause();
  v.removeAttribute('src');
  v.load();
  v.remove();
}

/** Resolve when any of the events fires (or the condition already holds); reject on error or timeout. */
function waitFor(v: HTMLVideoElement, events: string[], ready: () => boolean, ms: number, what: string): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(OPEN_ERROR));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out while ${what}.`));
    }, ms);
    const cleanup = () => {
      window.clearTimeout(timer);
      for (const e of events) v.removeEventListener(e, done);
      v.removeEventListener('error', fail);
    };
    for (const e of events) v.addEventListener(e, done);
    v.addEventListener('error', fail);
  });
}

/** Some files (e.g. WebM from screen recorders) report an infinite duration until the end is sought. */
async function resolveDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  v.currentTime = 1e101;
  await waitFor(v, ['durationchange', 'seeked'], () => Number.isFinite(v.duration) && v.duration > 0, 10000, 'reading the media duration').catch(() => undefined);
  const d = v.duration;
  v.currentTime = 0;
  return d;
}

/** Wait briefly for the seeked frame to be presented (bounded, so hidden tabs never hang). */
function settleFrame(v: HTMLVideoElement): Promise<void> {
  const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 60);
    if (rvfc) rvfc.call(v, () => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${t.toFixed(1)} s`));
    }, 8000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video decode error while seeking'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = t;
  });
}

export interface VideoProbe {
  hasVideo: boolean;
  duration: number;
  width: number;
  height: number;
}

export async function probeVideo(url: string): Promise<VideoProbe> {
  const v = hiddenVideo(url, 'metadata');
  try {
    await waitFor(v, ['loadedmetadata'], () => v.readyState >= 1, 20000, 'reading the file');
    const duration = await resolveDuration(v);
    return { hasVideo: v.videoWidth > 0 && v.videoHeight > 0, duration, width: v.videoWidth, height: v.videoHeight };
  } finally {
    disposeVideo(v);
  }
}

/**
 * Sample frames by seeking a hidden <video> element. Frames are drawn to small canvases
 * in memory only.
 */
export async function analyzeVideo(
  url: string,
  opts: { faces: boolean; onProgress?: (fraction: number, note: string) => void; signal?: AbortSignal },
): Promise<VideoAnalysis> {
  const video = hiddenVideo(url, 'auto');
  try {
    return await sampleFrames(video, opts);
  } finally {
    disposeVideo(video);
  }
}

async function sampleFrames(
  video: HTMLVideoElement,
  opts: { faces: boolean; onProgress?: (fraction: number, note: string) => void; signal?: AbortSignal },
): Promise<VideoAnalysis> {
  await waitFor(video, ['loadedmetadata'], () => video.readyState >= 1, 20000, 'opening the video');
  // Muted inline playback is allowed without a gesture; starting it once makes iOS decode frames.
  await video.play().catch(() => undefined);
  video.pause();
  await waitFor(video, ['loadeddata', 'canplay'], () => video.readyState >= 2, 20000, 'decoding the first video frame');
  const duration = await resolveDuration(video);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine the video duration.');
  const w = video.videoWidth;
  const h = video.videoHeight;
  const sw = SUMMARY_W;
  const sh = Math.max(16, Math.round((SUMMARY_W * h) / w));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = FACE_W;
  faceCanvas.height = Math.round((FACE_W * h) / w);
  const fctx = faceCanvas.getContext('2d')!;

  let faceapi: Awaited<ReturnType<typeof loadFaceDetector>> | null = null;
  let faceNote = 'Face detection was switched off.';
  if (opts.faces) {
    try {
      opts.onProgress?.(0, 'Loading local face detector');
      faceapi = await loadFaceDetector();
      faceNote = 'TinyFaceDetector (local, in-browser) on about one frame per second.';
    } catch (e) {
      faceNote = `Face detector could not be loaded (${(e as Error).message}); faces were not analysed.`;
    }
  }

  const step = sampleStep(duration);
  const faceEvery = Math.max(1, Math.round(1 / step));
  const samples: VideoSample[] = [];
  let prev: FrameSummary | null = null;
  const times: number[] = [];
  const hists: Float32Array[] = [];
  for (let t = 0.05, k = 0; t < duration; t += step, k++) {
    if (opts.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    await seek(video, t);
    await settleFrame(video);
    sctx.drawImage(video, 0, 0, sw, sh);
    const cur = summarize(sctx.getImageData(0, 0, sw, sh));
    let histDist = 0;
    let motion = 0;
    let residual = 0;
    let changed = 0;
    if (prev) {
      histDist = histDistance(prev.hist, cur.hist);
      const m = estimateMotion(prev.gray, cur.gray, sw, sh);
      motion = (m.globalPx + m.localPx) / sw / step;
      residual = m.residual;
      changed = m.changed;
    }
    let faces: number | null = null;
    let faceArea: number | null = null;
    if (faceapi && k % faceEvery === 0) {
      fctx.drawImage(video, 0, 0, faceCanvas.width, faceCanvas.height);
      try {
        const r = await detectFaces(faceapi, faceCanvas);
        faces = r.count;
        faceArea = r.maxArea;
      } catch {
        faces = null;
      }
    }
    samples.push({ t, luma: cur.luma, histDist, motion, residual, changed, faces, faceArea });
    times.push(t);
    hists.push(cur.hist);
    prev = cur;
    if (k % 4 === 0) opts.onProgress?.(t / duration, `Sampling frames ${Math.round(t)} / ${Math.round(duration)} s`);
  }
  const candidates = detectCuts(
    times,
    samples.map((s) => s.histDist),
  );
  const { cuts, flashes } = separateFlashes(times, hists, candidates);
  return { duration, step, width: w, height: h, samples, cuts, flashes, facesAnalyzed: !!faceapi, faceNote };
}
