/**
 * OPTIONAL local speech recognition with Whisper via transformers.js.
 *
 * External dependencies (only contacted after explicit opt-in):
 *  - cdn.jsdelivr.net: the transformers.js library and ONNX Runtime WebAssembly files
 *  - huggingface.co: the Whisper model weights (tens of megabytes)
 * Audio is NOT sent to either service: the model is downloaded and runs in this tab.
 * This path could not be exercised in the build environment (no network access to
 * those hosts), so it is marked experimental in the UI.
 */
import { ANALYSIS_RATE } from '../audio/dsp';
import { decodeChunks } from '../audio/decode';
import type { TranscriptCue } from '../../pipeline/types';

export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.web.min.js';
export const ASR_MODELS = {
  'english-tiny': { id: 'Xenova/whisper-tiny.en', label: 'Whisper tiny (English only)' },
  'multilingual-tiny': { id: 'Xenova/whisper-tiny', label: 'Whisper tiny (multilingual)' },
} as const;
export type AsrModelKey = keyof typeof ASR_MODELS;

interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}
type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: AsrChunk[] }>;

export async function transcribeLocally(
  file: File,
  model: AsrModelKey,
  opts: { onProgress: (note: string, fraction: number) => void; signal: AbortSignal; duration: number },
): Promise<TranscriptCue[]> {
  opts.onProgress('Downloading transformers.js from cdn.jsdelivr.net', 0);
  const lib = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as {
    pipeline: (task: string, model: string, o: Record<string, unknown>) => Promise<Transcriber>;
  };
  const transcriber = await lib.pipeline('automatic-speech-recognition', ASR_MODELS[model].id, {
    progress_callback: (p: { status?: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file) opts.onProgress(`Downloading model file ${p.file} from huggingface.co`, (p.progress ?? 0) / 100);
    },
  });
  const cues: TranscriptCue[] = [];
  const BLOCK = ANALYSIS_RATE * 120; // transcribe 2-minute blocks
  let pending: Float32Array[] = [];
  let pendingLen = 0;
  let offset = 0;
  const flush = async () => {
    if (!pendingLen) return;
    const block = new Float32Array(pendingLen);
    let o = 0;
    for (const p of pending) {
      block.set(p, o);
      o += p.length;
    }
    pending = [];
    pendingLen = 0;
    const out = await transcriber(block, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    for (const c of out.chunks ?? []) {
      const start = offset + (c.timestamp[0] ?? 0);
      const end = offset + (c.timestamp[1] ?? c.timestamp[0] ?? 0);
      if (c.text.trim()) cues.push({ start, end: Math.max(end, start), text: c.text.trim() });
    }
    offset += block.length / ANALYSIS_RATE;
    opts.onProgress(`Transcribed ${Math.round(offset)} / ${Math.round(opts.duration)} s locally`, Math.min(1, offset / opts.duration));
  };
  for await (const chunk of decodeChunks(file)) {
    if (opts.signal.aborted) throw new DOMException('Transcription cancelled', 'AbortError');
    pending.push(chunk);
    pendingLen += chunk.length;
    if (pendingLen >= BLOCK) await flush();
  }
  await flush();
  return cues;
}
