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
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'metadata';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () =>
      reject(
        new Error(
          "This browser could not open the file. Its codecs may not be supported here (for example, some Chromium builds lack H.264/AAC for MP4/MOV). Try Chrome, Edge, Safari or Firefox, or convert to WebM, MP3 or WAV.",
        ),
      );
  });
  const out = { hasVideo: v.videoWidth > 0 && v.videoHeight > 0, duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  v.removeAttribute('src');
  v.load();
  return out;
}

/**
 * Sample frames by seeking a hidden <video> element. Frames are drawn to small canvases
 * in memory only.
 */
export async function analyzeVideo(
  url: string,
  opts: { faces: boolean; onProgress?: (fraction: number, note: string) => void; signal?: AbortSignal },
): Promise<VideoAnalysis> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('The browser could not decode the video track.'));
  });
  const duration = video.duration;
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
  video.removeAttribute('src');
  video.load();
  const candidates = detectCuts(
    times,
    samples.map((s) => s.histDist),
  );
  const { cuts, flashes } = separateFlashes(times, hists, candidates);
  return { duration, step, width: w, height: h, samples, cuts, flashes, facesAnalyzed: !!faceapi, faceNote };
}
