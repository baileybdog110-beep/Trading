import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finishAudioAnalysis } from '../src/analysis/audio/analyze';
import { ANALYSIS_RATE, FrameAnalyzer, beatStrength, detectAbruptOnsets } from '../src/analysis/audio/dsp';
import { parseMp3Frame } from '../src/analysis/audio/decode';
import { Resampler, parseWavHeader, pcmToMono } from '../src/analysis/audio/wav';
import { assemble } from '../src/analysis/assemble';
import { parseTranscript } from '../src/analysis/transcript/parse';
import { languageStats } from '../src/analysis/transcript/language';
import { detectCuts, estimateMotion, histDistance, separateFlashes, summarize } from '../src/analysis/video/frameStats';

function frames(x: Float32Array) {
  const fa = new FrameAnalyzer();
  for (let i = 0; i < x.length; i += 5000) fa.push(x.subarray(i, i + 5000));
  return fa.out;
}

function clickTrack(seconds: number, bpm: number, level = 0.5): Float32Array {
  const x = new Float32Array(seconds * ANALYSIS_RATE);
  const period = Math.round((60 / bpm) * ANALYSIS_RATE);
  for (let i = 0; i < x.length; i += period) for (let k = 0; k < 400 && i + k < x.length; k++) x[i + k] = level * Math.sin(k * 0.3) * Math.exp(-k / 80);
  // quiet sustained tone underneath so the file is never silent
  for (let i = 0; i < x.length; i++) x[i] += 0.05 * Math.sin((2 * Math.PI * 220 * i) / ANALYSIS_RATE);
  return x;
}

describe('audio DSP (synthetic signals)', () => {
  it('finds the beat of a regular click track', () => {
    const f = frames(clickTrack(12, 120));
    const b = beatStrength(f.flux, 0, f.flux.length);
    expect(Math.abs(b.bpm - 120)).toBeLessThan(6);
    expect(b.clarity).toBeGreaterThan(0.4);
  });

  it('reports no beat for noise', () => {
    const x = new Float32Array(12 * ANALYSIS_RATE);
    let seed = 1;
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 16807) % 2147483647;
      x[i] = 0.2 * ((seed / 2147483647) * 2 - 1);
    }
    const f = frames(x);
    expect(beatStrength(f.flux, 0, f.flux.length).clarity).toBeLessThan(0.3);
  });

  it('detects an abrupt loud onset after quiet, but not in steady sound', () => {
    const x = new Float32Array(6 * ANALYSIS_RATE);
    for (let i = 0; i < x.length; i++) x[i] = 0.003 * Math.sin(i * 0.05);
    for (let i = 3 * ANALYSIS_RATE; i < 3.5 * ANALYSIS_RATE; i++) x[i] = 0.8 * Math.sin(i * 0.37);
    const onsets = detectAbruptOnsets(frames(x).db);
    expect(onsets.length).toBe(1);
    expect(Math.abs(onsets[0] - 3)).toBeLessThan(0.1);
    const steady = new Float32Array(6 * ANALYSIS_RATE).map((_, i) => 0.3 * Math.sin(i * 0.1));
    expect(detectAbruptOnsets(frames(steady).db)).toEqual([]);
  });

  it('marks silence as no sound and never invents visual or language features from audio', () => {
    const silent = new Float32Array(20 * ANALYSIS_RATE);
    const audio = finishAudioAnalysis(frames(silent), 20);
    const { segments } = assemble({ duration: 20, audio, video: null, cues: [] });
    for (const s of segments) {
      expect(s.features.sound_present?.present).toBe(false);
      expect(s.features.speech_present?.present).toBe(false);
      expect(s.features.visual_input).toBeUndefined();
      expect(s.features.transcribed_speech).toBeUndefined();
    }
  });
});

describe('file parsing', () => {
  it('parses a 16-bit stereo WAV header and PCM', () => {
    const n = 100;
    const buf = new ArrayBuffer(44 + n * 4);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + n * 4, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, 44100, true);
    v.setUint32(28, 44100 * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      v.setInt16(44 + i * 4, 16384, true);
      v.setInt16(46 + i * 4, -16384, true);
    }
    const info = parseWavHeader(buf);
    expect(info).toMatchObject({ sampleRate: 44100, channels: 2, bitsPerSample: 16, format: 'int', dataOffset: 44 });
    const mono = pcmToMono(buf.slice(44), info);
    expect(mono.length).toBe(n);
    expect(Math.abs(mono[10])).toBeLessThan(1e-6); // L and R cancel
  });

  it('resamples to the analysis rate with the right length', () => {
    const rs = new Resampler(48000, 16000);
    let total = 0;
    for (let i = 0; i < 10; i++) total += rs.push(new Float32Array(4800).fill(0.5)).length;
    expect(Math.abs(total - 16000)).toBeLessThan(20);
  });

  it('parses an MPEG-1 Layer III frame header', () => {
    // 0xFFFB9064: MPEG1, Layer III, 128 kbps, 44.1 kHz, no padding -> 417 bytes, 1152 samples
    const v = new DataView(new Uint8Array([0xff, 0xfb, 0x90, 0x64]).buffer);
    expect(parseMp3Frame(v, 0)).toMatchObject({ length: 417, samples: 1152, sampleRate: 44100 });
    expect(parseMp3Frame(new DataView(new Uint8Array([0x49, 0x44, 0x33, 0x03]).buffer), 0)).toBeNull();
  });

  it('parses SRT, VTT, Whisper JSON and plain text transcripts', () => {
    const srt = parseTranscript('a.srt', '1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>Second</i> line\n');
    expect(srt).toMatchObject({ timed: true, format: 'srt' });
    expect(srt.cues).toEqual([
      { start: 1, end: 2.5, text: 'Hello there.' },
      { start: 3, end: 4, text: 'Second line' },
    ]);
    const vtt = parseTranscript('a.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi\n');
    expect(vtt.cues).toEqual([{ start: 1, end: 2, text: 'Hi' }]);
    const json = parseTranscript('a.json', JSON.stringify({ chunks: [{ timestamp: [0.5, 1.5], text: ' yes ' }] }));
    expect(json.cues).toEqual([{ start: 0.5, end: 1.5, text: 'yes' }]);
    const txt = parseTranscript('a.txt', 'Just words.');
    expect(txt).toMatchObject({ timed: false, format: 'text', text: 'Just words.' });
  });

  it('counts lexical cues transparently', () => {
    const s = languageStats('[laughter] She thought he knew. Then they wondered, haha, and she felt happy.', 6);
    expect(s.laughter).toBe(2);
    expect(s.mentalState).toBe(4);
    expect(s.emotion).toBe(1);
    expect(s.wpm).toBeGreaterThan(0);
  });
});

describe('video frame statistics (synthetic frames)', () => {
  const frame = (w: number, h: number, f: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = f(x, y);
        data.set([r, g, b, 255], (y * w + x) * 4);
      }
    return { width: w, height: h, data };
  };
  it('estimates a global shift and detects a hard cut', () => {
    const pattern = (dx: number) => frame(96, 54, (x, y) => {
      const v = ((Math.floor((x - dx) / 6) + Math.floor(y / 6)) % 2) * 200 + 20;
      return [v, v, v];
    });
    const a = summarize(pattern(0));
    const b = summarize(pattern(3));
    const m = estimateMotion(a.gray, b.gray, 96, 54);
    expect(m.globalPx).toBeGreaterThanOrEqual(2);
    const red = summarize(frame(96, 54, () => [230, 30, 30]));
    expect(histDistance(a.hist, red.hist)).toBeGreaterThan(0.8);
    const times = [0, 0.5, 1, 1.5, 2, 2.5, 3];
    const dists = [0, 0.02, 0.03, 0.9, 0.02, 0.03, 0.02];
    expect(detectCuts(times, dists)).toEqual([1.5]);
  });

  it('counts a small moving object as changed pixels', () => {
    const blob = (cx: number) => summarize(frame(96, 54, (x, y) => (Math.hypot(x - cx, y - 27) < 8 ? [240, 220, 120] : [40, 77, 143])));
    const m = estimateMotion(blob(20).gray, blob(40).gray, 96, 54);
    expect(m.changed).toBeGreaterThan(0.03);
    const still = estimateMotion(blob(20).gray, blob(20).gray, 96, 54);
    expect(still.changed).toBe(0);
  });

  it('treats a jump-and-return as a flash rather than a cut', () => {
    const dark = summarize(frame(96, 54, () => [30, 30, 30])).hist;
    const bright = summarize(frame(96, 54, () => [235, 235, 235])).hist;
    const other = summarize(frame(96, 54, () => [200, 30, 30])).hist;
    const times = [0, 0.5, 1, 1.5, 2, 2.5];
    // dark, dark, BRIGHT (flash), dark, dark, RED (real cut)
    const hists = [dark, dark, bright, dark, dark, other];
    const r = separateFlashes(times, hists, [1, 1.5, 2.5]);
    expect(r.flashes).toEqual([1]);
    expect(r.cuts).toEqual([2.5]);
  });
});

const FIX = 'tests/fixtures/program.wav';
describe.skipIf(!existsSync(FIX))('synthetic program fixture (run scripts/testdata/make_fixtures.py)', () => {
  it('finds speech, music with a beat, and the noise burst in the right places', () => {
    const b = readFileSync(FIX);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const info = parseWavHeader(ab);
    const x = pcmToMono(ab.slice(info.dataOffset), info);
    const audio = finishAudioAnalysis(frames(x), x.length / ANALYSIS_RATE);
    const cues = parseTranscript('program.srt', readFileSync('tests/fixtures/program.srt', 'utf8')).cues;
    const { segments } = assemble({ duration: audio.duration, audio, video: null, cues });
    const at = (t: number) => segments.find((s) => t >= s.start && t < s.end)!;
    expect(at(10).features.speech_present?.present).toBe(true);
    expect(at(10).features.transcribed_speech?.present).toBe(true);
    expect(at(30).features.music_present?.present).toBe(true);
    expect(at(30).features.regular_beat?.present).toBe(true);
    expect(Math.abs(Number(at(30).features.regular_beat?.values?.bpm) - 120)).toBeLessThan(8);
    expect(at(30).features.speech_present?.present).toBe(false);
    expect(audio.onsets.some((t) => Math.abs(t - 40.9) < 0.3)).toBe(true);
  });
});
