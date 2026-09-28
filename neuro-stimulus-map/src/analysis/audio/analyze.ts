import { ANALYSIS_RATE, FPS, FrameAnalyzer, classifyWindows, detectAbruptOnsets, type FrameFeatures, type WindowClass } from './dsp';

export interface AudioAnalysis {
  duration: number;
  frames: FrameFeatures;
  windows: WindowClass[];
  onsets: number[];
}

/**
 * Consume mono PCM chunks at ANALYSIS_RATE (e.g. from a chunked decoder) and compute
 * frame features. Only compact per-frame summaries are retained, never the audio itself.
 */
export async function analyzeAudioStream(
  chunks: AsyncIterable<Float32Array>,
  onProgress?: (seconds: number) => void,
  signal?: AbortSignal,
): Promise<AudioAnalysis> {
  const fa = new FrameAnalyzer();
  let samples = 0;
  for await (const chunk of chunks) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    fa.push(chunk);
    samples += chunk.length;
    onProgress?.(samples / ANALYSIS_RATE);
  }
  return finishAudioAnalysis(fa.out, samples / ANALYSIS_RATE);
}

export function finishAudioAnalysis(frames: FrameFeatures, duration: number): AudioAnalysis {
  return { duration, frames, windows: classifyWindows(frames), onsets: detectAbruptOnsets(frames.db) };
}

export const frameIndex = (t: number) => Math.max(0, Math.round(t * FPS));
