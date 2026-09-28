/**
 * Browser-side chunked audio decoding. Everything happens locally; no audio leaves the device.
 *
 * Strategies:
 *  - WAV: header parsed, PCM streamed in slices (any length).
 *  - MP3: file split at MPEG frame boundaries and decoded slice by slice (any length).
 *  - Other containers (MP4, MOV, M4A, AAC, OGG, WEBM, FLAC): the browser decodes the whole
 *    audio track at 16 kHz. Very long files of this kind can exceed browser memory.
 */
import { ANALYSIS_RATE } from './dsp';
import { Resampler, parseWavHeader, pcmToMono } from './wav';

export type DecodeStrategy = 'wav-stream' | 'mp3-chunks' | 'whole-file';

export function chooseStrategy(file: File): DecodeStrategy {
  const name = file.name.toLowerCase();
  if (name.endsWith('.wav') || file.type === 'audio/wav' || file.type === 'audio/x-wav') return 'wav-stream';
  if (name.endsWith('.mp3') || file.type === 'audio/mpeg') return 'mp3-chunks';
  return 'whole-file';
}

/** Soft limit for whole-file decoding (bytes). Beyond this we warn the user. */
export const WHOLE_FILE_WARN_BYTES = 800 * 1024 * 1024;
/** Whole-file decoding of media longer than this may exhaust memory on phones and tablets. */
export const WHOLE_FILE_WARN_SECONDS = 45 * 60;

/**
 * Decoding-context sample rates to try. 16 kHz avoids a resampling step, but some browsers
 * (older iOS Safari in particular) only accept common rates, so we fall back and resample.
 */
const DECODE_RATES = [ANALYSIS_RATE, 22050, 44100, 48000];
let workingRate: number | null = null;

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

function offlineContext(rate: number): OfflineAudioContext {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('This browser has no Web Audio decoding support.');
  return new Ctor(1, rate, rate);
}

/** decodeAudioData with both the promise form and the legacy callback form (older Safari). */
function decodeCompat(ctx: OfflineAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error('Audio decoding failed')));
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

async function decodeWithBrowser(bytes: ArrayBuffer): Promise<AudioBuffer> {
  let lastError: unknown = null;
  for (const rate of workingRate ? [workingRate] : DECODE_RATES) {
    let ctx: OfflineAudioContext;
    try {
      ctx = offlineContext(rate);
    } catch (e) {
      lastError = e; // this rate is not supported here; try the next one
      continue;
    }
    workingRate = rate;
    return await decodeCompat(ctx, bytes);
  }
  throw lastError ?? new Error('No supported audio decoding sample rate.');
}

/** Mono mix of frames [from, to) of an AudioBuffer. */
function monoSlice(buf: AudioBuffer, from = 0, to = buf.length): Float32Array {
  const out = new Float32Array(Math.max(0, to - from));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = from; i < to; i++) out[i - from] += d[i] / buf.numberOfChannels;
  }
  return out;
}

async function* wavChunks(file: File): AsyncGenerator<Float32Array> {
  const head = await file.slice(0, Math.min(file.size, 1 << 16)).arrayBuffer();
  const info = parseWavHeader(head);
  const bytesPerFrame = (info.bitsPerSample / 8) * info.channels;
  const end = Math.min(file.size, info.dataBytes > 0 && info.dataBytes < 0xffffffff ? info.dataOffset + info.dataBytes : file.size);
  const step = bytesPerFrame * info.sampleRate * 30; // 30 s per slice
  const rs = new Resampler(info.sampleRate, ANALYSIS_RATE);
  for (let off = info.dataOffset; off < end; off += step) {
    const bytes = await file.slice(off, Math.min(end, off + step)).arrayBuffer();
    yield rs.push(pcmToMono(bytes, info));
  }
}

const MP3_BITRATES: Record<string, number[]> = {
  // [version][layer] -> kbps table index 1..14 (MPEG1 L3, MPEG2/2.5 L3)
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface Mp3Frame {
  offset: number;
  length: number;
  samples: number;
  sampleRate: number;
}

/** Parse an MPEG audio Layer III frame header at offset, or return null. */
export function parseMp3Frame(v: DataView, offset: number): Mp3Frame | null {
  if (offset + 4 > v.byteLength) return null;
  const b1 = v.getUint8(offset);
  const b2 = v.getUint8(offset + 1);
  if (b1 !== 0xff || (b2 & 0xe0) !== 0xe0) return null;
  const versionBits = (b2 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layerBits = (b2 >> 1) & 3; // 1 = Layer III
  if (versionBits === 1 || layerBits !== 1) return null;
  const b3 = v.getUint8(offset + 2);
  const brIdx = b3 >> 4;
  const srIdx = (b3 >> 2) & 3;
  const pad = (b3 >> 1) & 1;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const mpeg1 = versionBits === 3;
  const bitrate = MP3_BITRATES[mpeg1 ? '1-3' : '2-3'][brIdx] * 1000;
  const sampleRate = MP3_RATES[versionBits][srIdx];
  const samples = mpeg1 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + pad;
  return length > 4 ? { offset, length, samples, sampleRate } : null;
}

/** Skip an ID3v2 tag if present. */
function id3Size(v: DataView): number {
  if (v.byteLength < 10 || v.getUint8(0) !== 0x49 || v.getUint8(1) !== 0x44 || v.getUint8(2) !== 0x33) return 0;
  const size = ((v.getUint8(6) & 0x7f) << 21) | ((v.getUint8(7) & 0x7f) << 14) | ((v.getUint8(8) & 0x7f) << 7) | (v.getUint8(9) & 0x7f);
  return 10 + size;
}

async function* mp3Chunks(file: File): AsyncGenerator<Float32Array> {
  const SLICE = 4 * 1024 * 1024;
  const headBuf = await file.slice(0, Math.min(file.size, 1 << 20)).arrayBuffer();
  let pos = id3Size(new DataView(headBuf));
  let resampler: Resampler | null = null;
  while (pos < file.size) {
    const buf = await file.slice(pos, Math.min(file.size, pos + SLICE + 4096)).arrayBuffer();
    const v = new DataView(buf);
    // find first valid frame (two consecutive headers)
    let start = 0;
    while (start < v.byteLength - 4) {
      const f = parseMp3Frame(v, start);
      if (f && (start + f.length >= v.byteLength - 4 || parseMp3Frame(v, start + f.length))) break;
      start++;
    }
    let off = start;
    let samples = 0;
    let rate = 0;
    while (off < Math.min(v.byteLength, SLICE)) {
      const f = parseMp3Frame(v, off);
      if (!f || off + f.length > v.byteLength) break;
      samples += f.samples;
      rate = f.sampleRate;
      off += f.length;
    }
    if (off === start) break; // no more frames
    const buffer = await decodeWithBrowser(buf.slice(start, off));
    const decoded = monoSlice(buffer);
    // Force the decoded length to the exact frame-count duration so timing does not drift
    // across slices (decoders add priming delay to each independently decoded slice).
    const expected = Math.round((samples / rate) * buffer.sampleRate);
    let out = decoded;
    if (decoded.length > expected) out = decoded.subarray(decoded.length - expected);
    else if (decoded.length < expected) {
      out = new Float32Array(expected);
      out.set(decoded);
    }
    resampler ??= new Resampler(buffer.sampleRate, ANALYSIS_RATE);
    yield resampler.push(out);
    pos += off;
  }
}

async function* wholeFileChunks(file: File): AsyncGenerator<Float32Array> {
  const buffer = await decodeWithBrowser(await file.arrayBuffer());
  const rs = new Resampler(buffer.sampleRate, ANALYSIS_RATE);
  const step = buffer.sampleRate * 60;
  for (let i = 0; i < buffer.length; i += step) yield rs.push(monoSlice(buffer, i, Math.min(buffer.length, i + step)));
}

export function decodeChunks(file: File, strategy = chooseStrategy(file)): AsyncGenerator<Float32Array> {
  if (strategy === 'wav-stream') return wavChunks(file);
  if (strategy === 'mp3-chunks') return mp3Chunks(file);
  return wholeFileChunks(file);
}
