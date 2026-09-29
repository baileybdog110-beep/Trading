import { readFileSync } from 'node:fs';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { EmotionFrameAnalyzer } from '../src/emotion/features';
import { buildMusicnn, melPatches, type Musicnn, type MusicnnManifest } from '../src/emotion/musicnn';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public/models/musicnn/manifest.json', root), 'utf8')) as MusicnnManifest;
const buf = (p: string) => {
  const b = readFileSync(new URL(p, root));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const ref = JSON.parse(readFileSync(new URL('tests/fixtures-model/musicnn_reference.json', root), 'utf8')) as { pcm: number[]; mel: number[][]; expected: number[] };

describe('musicnn in TensorFlow.js matches the NumPy reference of the original checkpoint', () => {
  let model: Musicnn;
  beforeAll(async () => {
    await tf.setBackend('cpu');
    model = buildMusicnn(tf, manifest, buf('public/models/musicnn/weights.bin'));
  });

  it('same tag probabilities from the same log-mel patch', async () => {
    const [p] = await model.predict([Float32Array.from(ref.mel.flat())]);
    expect(p.length).toBe(50);
    let maxDiff = 0;
    ref.expected.forEach((v, i) => (maxDiff = Math.max(maxDiff, Math.abs(p[i] - v))));
    expect(maxDiff).toBeLessThan(2e-3);
  }, 60000);

  it('the streaming log-mel front end matches librosa', () => {
    const fb = new Float32Array(buf('public/models/musicnn/mel_filters.bin'));
    const ea = new EmotionFrameAnalyzer(fb);
    ea.push(Float32Array.from(ref.pcm));
    const { logmel } = ea.finish();
    let maxDiff = 0;
    for (let t = 0; t < ref.mel.length; t++) for (let b = 0; b < 96; b++) maxDiff = Math.max(maxDiff, Math.abs(logmel![t][b] - ref.mel[t][b]));
    expect(maxDiff).toBeLessThan(2e-3);
  });

  it('patches cover the file and respect the cap', () => {
    const frames = Array.from({ length: 1000 }, () => new Float32Array(96));
    expect(melPatches(frames, 94).length).toBe(Math.ceil((1000 - 187 + 1) / 94));
    expect(melPatches(frames, 94, 3).length).toBeLessThanOrEqual(3);
    expect(melPatches(frames.slice(0, 50), 94).length).toBe(1);
  });
});

describe('coarse-to-fine tagging order', () => {
  it('visits every window once, spreading the first ones over the whole track', async () => {
    const { coarseToFine } = await import('../src/emotion/analyze');
    const o = coarseToFine(40);
    expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(o.slice(0, 3)).toEqual([0, 16, 32]);
  });
});
