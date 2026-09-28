/** Minimal streaming WAV (RIFF/WAVE) reader: PCM 8/16/24/32-bit integer and 32/64-bit float. */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: 'int' | 'float';
  dataOffset: number;
  dataBytes: number;
  duration: number;
}

export function parseWavHeader(buf: ArrayBuffer): WavInfo {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let off = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes' | 'duration'> | null = null;
  while (off + 8 <= v.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      let audioFormat = v.getUint16(off + 8, true);
      const channels = v.getUint16(off + 10, true);
      const sampleRate = v.getUint32(off + 12, true);
      const bitsPerSample = v.getUint16(off + 22, true);
      if (audioFormat === 0xfffe && size >= 26) audioFormat = v.getUint16(off + 32, true); // WAVE_FORMAT_EXTENSIBLE subformat
      if (audioFormat !== 1 && audioFormat !== 3) throw new Error(`Unsupported WAV encoding (format ${audioFormat})`);
      fmt = { sampleRate, channels, bitsPerSample, format: audioFormat === 3 ? 'float' : 'int' };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data chunk before fmt chunk');
      const bytesPerFrame = (fmt.bitsPerSample / 8) * fmt.channels;
      // Some writers put 0 or 0xFFFFFFFF for streamed files; caller clamps to file size.
      return { ...fmt, dataOffset: off + 8, dataBytes: size, duration: size / bytesPerFrame / fmt.sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV data chunk not found in header region');
}

/** Decode interleaved PCM bytes into a mono Float32Array (channel average). */
export function pcmToMono(bytes: ArrayBuffer, info: Pick<WavInfo, 'channels' | 'bitsPerSample' | 'format'>): Float32Array {
  const v = new DataView(bytes);
  const bps = info.bitsPerSample / 8;
  const frames = Math.floor(bytes.byteLength / (bps * info.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < info.channels; c++) {
      const o = (i * info.channels + c) * bps;
      let x: number;
      if (info.format === 'float') x = bps === 8 ? v.getFloat64(o, true) : v.getFloat32(o, true);
      else if (bps === 1) x = (v.getUint8(o) - 128) / 128;
      else if (bps === 2) x = v.getInt16(o, true) / 32768;
      else if (bps === 3) {
        const b = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
        x = b / 8388608;
      } else x = v.getInt32(o, true) / 2147483648;
      s += x;
    }
    out[i] = s / info.channels;
  }
  return out;
}

/**
 * Streaming resampler to a target rate using a box low-pass + linear interpolation.
 * Adequate for feature extraction (not for listening).
 */
export class Resampler {
  private carry = new Float32Array(0);
  private pos = 0; // fractional read position into (carry + next chunk), in source samples
  private readonly ratio: number;
  private readonly box: number;

  constructor(readonly from: number, readonly to: number) {
    this.ratio = from / to;
    this.box = Math.max(1, Math.floor(this.ratio));
  }

  push(x: Float32Array): Float32Array {
    if (this.from === this.to) return x;
    const src = new Float32Array(this.carry.length + x.length);
    src.set(this.carry);
    src.set(x, this.carry.length);
    // box filter (moving average) to reduce aliasing when downsampling
    let filtered = src;
    if (this.box > 1) {
      filtered = new Float32Array(src.length);
      let acc = 0;
      for (let i = 0; i < src.length; i++) {
        acc += src[i];
        if (i >= this.box) acc -= src[i - this.box];
        filtered[i] = acc / Math.min(i + 1, this.box);
      }
    }
    const out: number[] = [];
    while (this.pos + 1 < filtered.length) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      out.push(filtered[i] * (1 - f) + filtered[i + 1] * f);
      this.pos += this.ratio;
    }
    const keepFrom = Math.max(0, Math.floor(this.pos) - this.box);
    this.carry = src.slice(keepFrom);
    this.pos -= keepFrom;
    return Float32Array.from(out);
  }
}
