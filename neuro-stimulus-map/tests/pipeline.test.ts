import { describe, expect, it } from 'vitest';
import { assemble } from '../src/analysis/assemble';
import { demoSession } from '../src/demo/demoSession';
import { db, sourceById } from '../src/evidence/db';
import type { FeatureId } from '../src/evidence/types';
import { DEFAULT_CONTEXT, mapSegment } from '../src/pipeline/mapping';
import type { DetectedFeature, Segment } from '../src/pipeline/types';

const feat = (id: FeatureId, extra: Partial<DetectedFeature> = {}): DetectedFeature => ({
  id,
  present: true,
  confidence: 'high',
  status: 'auto',
  source: 'audio',
  measurement: 'test',
  ...extra,
});
const segWith = (...fs: DetectedFeature[]): Segment => ({
  id: 't',
  index: 0,
  start: 0,
  end: 10,
  label: 'test',
  cues: [],
  features: Object.fromEntries(fs.map((f) => [f.id, f])),
});

describe('mapping pipeline', () => {
  it('only colours meshes through an evidence record with a supporting, existing source', () => {
    const all = db.features.map((f) => feat(f.id, { status: 'confirmed' }));
    const segments = [...demoSession().segments, segWith(...all)];
    for (const s of segments) {
      const m = mapSegment(db, s, DEFAULT_CONTEXT);
      for (const r of m.meshes.values()) {
        expect(r.hits.length, r.meshId).toBeGreaterThan(0);
        for (const h of r.hits) {
          expect(db.associations).toContain(h.association);
          const supporting = h.association.citations.filter((c) => c.role === 'supports' && sourceById.has(c.source));
          expect(supporting.length, h.association.id).toBeGreaterThan(0);
          // the hit must be reachable: its rule's feature is present in the segment
          expect(s.features[h.rule.feature]?.present).toBe(true);
        }
      }
    }
  });

  it('returns an explicit insufficient-evidence result for unsupported inputs', () => {
    for (const id of ['emotional_theme', 'surprise'] as FeatureId[]) {
      const m = mapSegment(db, segWith(feat(id, { status: 'confirmed', source: 'user' })), DEFAULT_CONTEXT);
      expect(m.meshes.size, id).toBe(0);
      const step = m.steps.find((s) => s.rule.feature === id)!;
      expect(step.outcome.kind).toBe('fired');
      expect(step.associations).toEqual([]);
      expect(step.unsupported.length, id).toBeGreaterThan(0);
    }
  });

  it('shows the tempo note but maps no region for a tempo value', () => {
    const m = mapSegment(db, segWith(feat('regular_beat', { confidence: 'moderate', values: { bpm: 128 } })), DEFAULT_CONTEXT);
    expect(m.featureNotes.map((u) => u.id)).toContain('u_tempo_value');
    for (const r of m.meshes.values()) for (const h of r.hits) expect(h.association.process).toBe('beat_perception');
  });

  it('ignores suggestions until a person confirms them', () => {
    const suggested = mapSegment(db, segWith(feat('humor', { status: 'suggested', source: 'llm', confidence: 'low' })), DEFAULT_CONTEXT);
    expect(suggested.meshes.size).toBe(0);
    expect(suggested.steps.every((s) => s.outcome.kind === 'needs-confirmation')).toBe(true);
    const confirmed = mapSegment(db, segWith(feat('humor', { status: 'confirmed', source: 'user' })), DEFAULT_CONTEXT);
    expect(confirmed.meshes.size).toBeGreaterThan(0);
  });

  it('respects rejections, absent features and minimum detection confidence', () => {
    expect(mapSegment(db, segWith(feat('faces_visible', { status: 'rejected' })), DEFAULT_CONTEXT).meshes.size).toBe(0);
    expect(mapSegment(db, segWith(feat('faces_visible', { present: false })), DEFAULT_CONTEXT).meshes.size).toBe(0);
    const low = mapSegment(db, segWith(feat('faces_visible', { confidence: 'low' })), DEFAULT_CONTEXT);
    expect(low.meshes.size).toBe(0);
    expect(low.steps[0].outcome.kind).toBe('below-confidence');
  });

  it('lets listener context remove listener-dependent associations', () => {
    const s = segWith(feat('music_present', { confidence: 'moderate' }));
    const unknown = mapSegment(db, s, DEFAULT_CONTEXT);
    expect(unknown.steps.find((x) => x.rule.id === 'r_music_reward')?.conditional).toBe(true);
    const no = mapSegment(db, s, { ...DEFAULT_CONTEXT, enjoys_music: 'no' });
    expect(no.steps.find((x) => x.rule.id === 'r_music_reward')?.outcome.kind).toBe('listener-context');
    const rewardMeshes = [...no.meshes.values()].filter((r) => r.hits.some((h) => h.association.process === 'music_evoked_reward'));
    expect(rewardMeshes).toEqual([]);
  });

  it('marks contested regions only when every hit is contested', () => {
    const m = mapSegment(db, segWith(feat('music_present', { confidence: 'moderate' })), { ...DEFAULT_CONTEXT, enjoys_music: 'no' });
    const opercularis = m.meshes.get('L_pars_opercularis');
    expect(opercularis?.grade).toBe('contested');
  });
});

describe('modality honesty', () => {
  it('produces only transcript features when only a transcript is available', () => {
    const cues = [
      { start: 1, end: 6, text: 'When she arrived she thought about her brother and wondered what he wanted.' },
      { start: 6, end: 12, text: 'Later that night he called, and they talked about the storm and the town.' },
    ];
    const { segments, tracks } = assemble({ duration: 14, audio: null, video: null, cues });
    const modalities = new Set(segments.flatMap((s) => Object.values(s.features).map((f) => f!.source)));
    expect([...modalities].every((m) => m === 'transcript')).toBe(true);
    for (const s of segments) {
      for (const id of ['sound_present', 'music_present', 'regular_beat', 'loudness_change', 'abrupt_onset', 'visual_input', 'visual_motion', 'faces_visible', 'scene_cut'] as FeatureId[]) {
        expect(s.features[id], id).toBeUndefined();
      }
    }
    expect(tracks.level).toBeUndefined();
    expect(tracks.motion).toBeUndefined();
  });
});
