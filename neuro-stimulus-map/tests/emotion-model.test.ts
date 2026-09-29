import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vaModel from '../data/emotion/valence_arousal.json';
import { FrameAnalyzer, detectAbruptOnsets } from '../src/analysis/audio/dsp';
import { EmotionFrameAnalyzer } from '../src/emotion/features';
import { SYSTEMS, buildEmotion, contributions, emotionLabel, meshColours, modelInfo, predict, silentTimeline, systemsAt, withVisual } from '../src/emotion/model';
import { visualEmotion } from '../src/emotion/visual';
import type { VideoAnalysis, VideoSample } from '../src/analysis/video/types';
import { db } from '../src/evidence/db';

const ref = JSON.parse(readFileSync(new URL('./fixtures-model/emotion_model_reference.json', import.meta.url), 'utf8')) as Record<
  string,
  { rows: number[][]; pieceMean: number[]; expected: { valence: number[]; arousal: number[] } }
>;

describe('valence/arousal model', () => {
  it('matches an independent Python evaluation of the exported coefficients', () => {
    for (const [name, r] of Object.entries(ref)) {
      const m = (vaModel.models as Record<string, unknown>)[name] as Parameters<typeof predict>[0];
      r.rows.forEach((row, i) => {
        expect(predict(m, 'valence', row, r.pieceMean)).toBeCloseTo(r.expected.valence[i], 6);
        expect(predict(m, 'arousal', row, r.pieceMean)).toBeCloseTo(r.expected.arousal[i], 6);
      });
    }
  });

  it('reports held-out accuracy and the human benchmark', () => {
    const info = modelInfo('cues+tags')!;
    expect(info.valence.r).toBeGreaterThan(0.5);
    expect(info.arousal.r).toBeGreaterThan(0.6);
    expect(info.rmse.valence).toBeGreaterThan(0.1);
    expect(vaModel.human.valence.oneListenerVsOthers_r).toBeGreaterThan(0.3);
  });
});

describe('emotion labels (circumplex)', () => {
  it('names the quadrants', () => {
    expect(emotionLabel(0.4, 0.4).id).toBe('joyful');
    expect(emotionLabel(-0.4, 0.4).id).toBe('tense');
    expect(emotionLabel(-0.4, -0.4).id).toBe('sad');
    expect(emotionLabel(0.4, -0.4).id).toBe('calm');
    expect(emotionLabel(0.02, 0.03).id).toBe('neutral');
    expect(emotionLabel(0.4, 0.4, true).id).toBe('silence');
  });
});

/**
 * Synthetic track: sparse soft notes in A minor, a crescendo, then loud fast notes in C major with
 * drum hits at 132 BPM. Piano-like notes (decaying harmonics) and noise drums, deterministic.
 */
function synth(): Float32Array {
  const sr = 16000;
  const y = new Float32Array(sr * 30);
  let seed = 1;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const note = (t0: number, f: number, amp: number) => {
    for (let i = Math.floor(t0 * sr); i < Math.min(y.length, Math.floor((t0 + 1.5) * sr)); i++) {
      const t = i / sr - t0;
      const e = amp * Math.exp(-t / 0.4);
      y[i] += e * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
    }
  };
  const drum = (t0: number, amp: number) => {
    for (let i = Math.floor(t0 * sr); i < Math.min(y.length, Math.floor((t0 + 0.12) * sr)); i++) y[i] += amp * Math.exp(-(i / sr - t0) / 0.03) * noise();
  };
  const aMinor = [220, 261.63, 329.63];
  const cMajor = [261.63, 329.63, 392, 523.25];
  for (let k = 0, t = 0.2; t < 12; t += 1.0, k++) note(t, aMinor[k % 3], 0.05);
  for (let k = 0, t = 12; t < 18; t += 0.5, k++) note(t, cMajor[k % 4], 0.04 + ((t - 12) / 6) * 0.14);
  for (let k = 0, t = 18; t < 30; t += 60 / 132 / 2, k++) note(t, cMajor[k % 4], 0.18);
  for (let t = 18; t < 30; t += 60 / 132) drum(t, 0.5);
  return y;
}

describe('emotion timeline and systems', () => {
  const y = synth();
  const fa = new FrameAnalyzer();
  const ea = new EmotionFrameAnalyzer();
  fa.push(y);
  ea.push(y);
  const tl = buildEmotion({ duration: 30, db: fa.out.db, flux: fa.out.flux, flatness: fa.out.flatness, frames: ea.finish(), onsets: detectAbruptOnsets(fa.out.db) });

  it('has one value per half second and uses the cue-only model without tags', () => {
    expect(tl.valence.length).toBe(61);
    expect(tl.model).toBe('cues');
    expect(tl.valence.every(Number.isFinite)).toBe(true);
  });

  it('the loud, fast section is more energetic than the quiet one, and the crescendo is found', () => {
    const avg = (xs: number[], a: number, b: number) => xs.slice(a / 0.5, b / 0.5).reduce((s, v) => s + v, 0) / ((b - a) / 0.5);
    expect(avg(tl.arousal, 22, 30)).toBeGreaterThan(avg(tl.arousal, 5, 11));
    expect(Math.max(...tl.build.slice(24, 38))).toBeGreaterThan(0.3);
    expect(tl.events.some((e) => (e.kind === 'buildup' || e.kind === 'peak') && e.t > 12 && e.t < 21)).toBe(true);
    expect(Math.max(...tl.groove.slice(46))).toBeGreaterThan(0.2);
  });

  it('liking scales the reward system only', () => {
    const i = 50;
    const yes = systemsAt(tl, i, 'yes');
    const no = systemsAt(tl, i, 'no');
    expect(no.level.reward).toBeLessThan(yes.level.reward);
    expect(no.level.stress).toBe(yes.level.stress);
  });

  it('every region a system lights is in the atlas and every cited source exists', () => {
    const regions = new Set(db.regions.map((r) => r.id));
    const sources = new Set(db.sources.map((s) => s.id));
    for (const s of SYSTEMS) {
      for (const r of s.regions) {
        expect(regions.has(r.region), r.region).toBe(true);
        for (const src of r.sources) expect(sources.has(src), src).toBe(true);
      }
      for (const e of s.evidence) expect(sources.has(e.source), e.source).toBe(true);
    }
    const state = systemsAt(tl, 50, 'yes');
    for (const p of state.parts) expect(regions.has(p.region), p.region).toBe(true);
    const out = meshColours(state, (id) => Object.values(db.regions.find((r) => r.id === id)!.meshes) as string[], new Map());
    for (const { v, rgb } of out.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      rgb.forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
    }
  });

  it('explanations sum to the estimate', () => {
    const i = 40;
    const c = contributions(tl, i, 'arousal');
    const m = vaModel.models.cues.arousal;
    const sum = c.reduce((s, x) => s + x.value, m.intercept);
    expect(sum).toBeCloseTo(tl.arousal[i], 6);
  });
});

describe('picture cues (video)', () => {
  const sample = (t: number, over: Partial<VideoSample> = {}): VideoSample => ({ t, luma: 0.42, sat: 0.3, histDist: 0, motion: 0, residual: 0, changed: 0, faces: null, faceArea: null, expr: null, ...over });
  const video = (samples: VideoSample[], cuts: number[] = []): VideoAnalysis => ({ duration: 10, step: 0.5, width: 320, height: 180, samples, cuts, flashes: [], facesAnalyzed: true, faceNote: '' });

  it('a large fearful face raises tension and the amygdala part of the stress system', () => {
    const calm = video(Array.from({ length: 20 }, (_, i) => sample(i * 0.5)));
    const scared = video(Array.from({ length: 20 }, (_, i) => sample(i * 0.5, i % 2 === 0 ? { faces: 1, faceArea: 0.08, expr: { fearful: 0.9, neutral: 0.1 } } : {})));
    const a = visualEmotion(calm, 20, 0.5);
    const b = visualEmotion(scared, 20, 0.5);
    expect(b.valence[10]).toBeLessThan(a.valence[10]);
    expect(b.arousal[10]).toBeGreaterThan(a.arousal[10]);
    expect(b.face[10]?.expr).toBe('fearful');
    const tl = withVisual(silentTimeline(10), b);
    const amyg = systemsAt(tl, 10, 'unsure').parts.find((p) => p.system === 'stress' && p.region === 'amygdala')!;
    expect(amyg.value).toBeGreaterThan(0.3);
  });

  it('fast motion and cuts raise arousal; the sound estimate stays in charge when there is sound', () => {
    const still = visualEmotion(video(Array.from({ length: 20 }, (_, i) => sample(i * 0.5))), 20, 0.5);
    const busy = visualEmotion(video(Array.from({ length: 20 }, (_, i) => sample(i * 0.5, { motion: 1 })), [3, 4, 4.5]), 20, 0.5);
    expect(busy.arousal[10]).toBeGreaterThan(still.arousal[10] + 0.2);
    const base = silentTimeline(10);
    const withSound = { ...base, silent: base.silent.map(() => false), valence: base.valence.map(() => 0.3), arousal: base.arousal.map(() => 0.1) };
    const fused = withVisual(withSound, busy);
    expect(fused.audio!.valence[10]).toBe(0.3);
    expect(fused.arousal[10]).toBeCloseTo(0.1 + 0.5 * busy.arousal[10], 9);
  });
});
