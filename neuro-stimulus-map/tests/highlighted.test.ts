import { describe, expect, it } from 'vitest';
import { demoSession } from '../src/demo/demoSession';
import { db } from '../src/evidence/db';
import { DEFAULT_CONTEXT, mapSegment } from '../src/pipeline/mapping';
import { groupAreas, reasonsFor, visibleIn } from '../src/ui/HighlightedPanel';

const maps = demoSession().segments.map((s) => mapSegment(db, s, DEFAULT_CONTEXT));

describe('Highlighted list', () => {
  it('lists every coloured mesh exactly once, merging left and right', () => {
    for (const m of maps) {
      const groups = groupAreas(m.meshes.values());
      const listed = groups.flatMap((g) => g.meshes.map((x) => x.meshId)).sort();
      expect(listed).toEqual([...m.meshes.keys()].sort());
      expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    }
  });

  it('gives every listed area a plain-language summary and at least one cited reason', () => {
    for (const m of maps) {
      for (const g of groupAreas(m.meshes.values())) {
        expect(g.summary.length, g.key).toBeGreaterThan(20);
        const reasons = reasonsFor(g.meshes);
        expect(reasons.length, g.key).toBeGreaterThan(0);
        for (const r of reasons) {
          expect(r.features.length, g.key).toBeGreaterThan(0);
          expect(r.association.citations.some((c) => c.role === 'supports')).toBe(true);
        }
      }
    }
  });

  it('puts findings that do not depend on the listener, and closer matches, first', () => {
    const order = { direct: 0, partial: 1, extrapolation: 2 };
    for (const m of maps) {
      const groups = groupAreas(m.meshes.values());
      for (let i = 1; i < groups.length; i++) {
        const [a, b] = [groups[i - 1], groups[i]];
        expect(Number(a.onlyConditional)).toBeLessThanOrEqual(Number(b.onlyConditional));
        if (a.onlyConditional === b.onlyConditional) expect(order[a.closest]).toBeLessThanOrEqual(order[b.closest]);
      }
    }
  });

  it('shows networks only in the networks view and cortical regions only in the regions view', () => {
    for (const m of maps) {
      for (const r of m.meshes.values()) {
        const cortical = r.kind === 'region' && db.regions.find((x) => x.id === r.id)?.kind === 'cortical';
        expect(visibleIn('anatomy', r)).toBe(r.kind === 'region');
        expect(visibleIn('networks', r)).toBe(r.kind === 'network' || !cortical);
      }
    }
  });
});
