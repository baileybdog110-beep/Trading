import { describe, expect, it } from 'vitest';
import { assemble } from '../src/analysis/assemble';
import { demoSession } from '../src/demo/demoSession';
import { db } from '../src/evidence/db';
import { buildHeatModel, SYSTEMS } from '../src/heat/model';
import { DEFAULT_CONTEXT, mapSegment } from '../src/pipeline/mapping';
import { applyOverrides, rejectFeature } from '../src/pipeline/overrides';
import type { AnalysisSession, TranscriptCue } from '../src/pipeline/types';

const demo = demoSession();
const cuesOf = (s: AnalysisSession) => [...new Set(s.segments.flatMap((x) => x.cues))];
const model = (s: AnalysisSession, ctx = DEFAULT_CONTEXT, segments = s.segments) => buildHeatModel(db, segments, s.tracks, cuesOf(s), ctx, s.duration);
const sys = (id: string) => SYSTEMS.findIndex((s) => s.id === id);
const times = (d: number) => Array.from({ length: Math.floor(d / 0.5) }, (_, i) => i * 0.5 + 0.25);

describe('estimated heat map', () => {
  it('only heats areas that the evidence pipeline links to that segment, and stays within 0..1', () => {
    const m = model(demo);
    const out = new Map<string, number>();
    let any = 0;
    for (const t of times(demo.duration)) {
      const seg = demo.segments.find((s) => t >= s.start && t < s.end)!;
      const allowed = mapSegment(db, seg, DEFAULT_CONTEXT).meshes;
      for (const [mesh, v] of m.meshHeat(t, out)) {
        expect(allowed.has(mesh), `${mesh} at ${t}s`).toBe(true);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
        any++;
      }
    }
    expect(any).toBeGreaterThan(0);
    for (const tr of m.traces) for (const v of tr) expect(v >= 0 && v <= 1).toBe(true);
  });

  it('follows the media over time: beat pulses move the music trace', () => {
    const m = model(demo);
    const music = [...m.traces[sys('music')].slice(0, 180)]; // first 18 s are music
    const mean = music.reduce((a, b) => a + b, 0) / music.length;
    const sd = Math.sqrt(music.reduce((a, b) => a + (b - mean) ** 2, 0) / music.length);
    expect(mean).toBeGreaterThan(0.2);
    expect(sd).toBeGreaterThan(0.02);
  });

  it('gives no hearing heat during silence, even where a segment says sound is present', () => {
    const silent: AnalysisSession = {
      ...demo,
      // a silent file has no level, no onset strength and no sudden sounds
      tracks: {
        ...demo.tracks,
        level: demo.tracks.level!.map(() => -90),
        onsets: [],
        fine: { step: demo.tracks.fine!.step, db: demo.tracks.fine!.db.map(() => -90), punch: demo.tracks.fine!.punch.map(() => 0) },
      },
    };
    const m = model(silent);
    for (const k of ['hearing', 'music', 'voice']) expect(Math.max(...m.traces[sys(k)]), k).toBeLessThan(0.05);
  });

  it('never heats hearing or vision from a transcript alone', () => {
    const cues: TranscriptCue[] = Array.from({ length: 12 }, (_, i) => ({
      start: i * 5,
      end: i * 5 + 4,
      text: 'She thought he knew what they wanted, and then later she remembered the storm over the town.',
    }));
    const { segments, tracks } = assemble({ duration: 60, audio: null, video: null, cues });
    const m = buildHeatModel(db, segments, tracks, cues, DEFAULT_CONTEXT, 60);
    for (const k of ['hearing', 'music', 'vision', 'motion', 'faces']) expect(Math.max(...m.traces[sys(k)]), k).toBe(0);
    expect(Math.max(...m.traces[sys('language')])).toBeGreaterThan(0.2);
  });

  it('respects listener answers and rejected features', () => {
    const t = 5; // music section
    const accumbens = (mm: ReturnType<typeof model>) => [...mm.meshHeat(t, new Map()).keys()].some((k) => k.includes('accumbens'));
    expect(accumbens(model(demo))).toBe(true);
    expect(accumbens(model(demo, { ...DEFAULT_CONTEXT, enjoys_music: 'no' }))).toBe(false);
    const seg = demo.segments[0];
    const rejected = applyOverrides(demo.segments, { [seg.id]: { music_present: rejectFeature(seg.features.music_present, 'music_present') } });
    const m = model(demo, DEFAULT_CONTEXT, rejected);
    expect(m.systemHeat(t)[sys('music')]).toBeLessThan(model(demo).systemHeat(t)[sys('music')]);
  });
});
