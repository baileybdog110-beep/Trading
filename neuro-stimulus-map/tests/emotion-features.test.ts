import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FrameAnalyzer } from '../src/analysis/audio/dsp';
import { CUES, EmotionFrameAnalyzer, cuesAt, dissonance, keyMode, pieceReference } from '../src/emotion/features';

/** Reference values from scripts/validation/emotion_features.py (the code checked against listener ratings). */
const ref = JSON.parse(readFileSync(new URL('./fixtures-model/emotion_features_reference.json', import.meta.url), 'utf8')) as {
  pcm16: string;
  pieceRef: number;
  frames: { centroid: number[]; power: number[]; chroma10: number[]; chroma60: number[]; nSmall: number; nChroma: number };
  cues: ({ t: number } & Record<string, number>)[];
};

function pcm(): Float32Array {
  const b = Buffer.from(ref.pcm16, 'base64');
  const i16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  return Float32Array.from(i16, (v) => v / 32767);
}

function analyse(chunk: number) {
  const y = pcm();
  const fa = new FrameAnalyzer();
  const ea = new EmotionFrameAnalyzer();
  for (let i = 0; i < y.length; i += chunk) {
    fa.push(y.subarray(i, Math.min(y.length, i + chunk)));
    ea.push(y.subarray(i, Math.min(y.length, i + chunk)));
  }
  return { fa: fa.out, frames: ea.finish() };
}

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

describe('emotion cues match the validated Python implementation', () => {
  const { fa, frames } = analyse(7919); // odd chunk size: streaming must not change anything

  it('frames: counts, centroid, power and chroma', () => {
    expect(frames.centroid.length).toBe(ref.frames.nSmall);
    expect(frames.chroma.length).toBe(ref.frames.nChroma);
    ref.frames.centroid.forEach((v, i) => expect(close(frames.centroid[i * 25], v, 1e-3)).toBe(true));
    ref.frames.power.forEach((v, i) => expect(close(frames.power[i * 25], v, 1e-3)).toBe(true));
    ref.frames.chroma10.forEach((v, k) => expect(close(frames.chroma[10][k], v, 1e-3)).toBe(true));
    ref.frames.chroma60.forEach((v, k) => expect(close(frames.chroma[60][k], v, 1e-3)).toBe(true));
  });

  it('piece loudness reference', () => {
    expect(pieceReference(fa.db)).toBeCloseTo(ref.pieceRef, 3);
  });

  it('cues at several moments', () => {
    const inp = { db: fa.db, flux: fa.flux, flatness: fa.flatness, frames, pieceRef: pieceReference(fa.db) };
    for (const want of ref.cues) {
      const got = cuesAt(inp, want.t);
      for (const c of CUES) {
        const tol = c === 'onset_rate' || c === 'tempo' || c === 'pulse' ? 1e-6 : 2e-3;
        expect({ t: want.t, c, v: got[c] }).toEqual({ t: want.t, c, v: close(got[c], want[c], tol) ? got[c] : want[c] + 999 });
      }
    }
  });

  it('streaming chunk size does not change the result', () => {
    const b = analyse(16000);
    expect(b.frames.centroid.length).toBe(frames.centroid.length);
    expect(b.frames.chroma[40][3]).toBeCloseTo(frames.chroma[40][3], 9);
  });
});

describe('key and dissonance helpers', () => {
  it('finds C major and A minor', () => {
    const cMajor = [1, 0, 0.2, 0, 1, 0.3, 0, 1, 0, 0.2, 0, 0.1];
    const k = keyMode(cMajor);
    expect(k.major).toBe(true);
    expect(k.key).toBe(0);
    expect(k.mode).toBeGreaterThan(0);
    const aMinor = [1, 0, 0.1, 0, 1, 0.1, 0, 0.3, 0.2, 1, 0, 0.1];
    const m = keyMode(aMinor);
    expect(m.major).toBe(false);
    expect(m.key).toBe(9);
    expect(m.mode).toBeLessThan(0);
  });
  it('semitone clusters are more dissonant than triads', () => {
    expect(dissonance([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeGreaterThan(dissonance([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]));
    expect(dissonance(new Array(12).fill(0))).toBe(0);
  });
});
