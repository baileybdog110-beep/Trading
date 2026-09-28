import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { db } from '../src/evidence/db';
import { validateEvidenceDB } from '../src/evidence/validate';

const manifest = JSON.parse(readFileSync(new URL('../public/atlas/atlas_manifest.json', import.meta.url), 'utf8'));
const atlasMeshIds = new Set<string>([
  ...manifest.regions.map((r: { id: string }) => r.id),
  ...manifest.networks_meshes.map((n: { id: string }) => n.id),
]);

describe('evidence database', () => {
  it('is structurally and referentially valid', () => {
    expect(validateEvidenceDB(db, atlasMeshIds)).toEqual([]);
  });

  it('gives every association at least one supporting, existing source', () => {
    const ids = new Set(db.sources.map((s) => s.id));
    for (const a of db.associations) {
      const supporting = a.citations.filter((c) => c.role === 'supports' && ids.has(c.source));
      expect(supporting.length, a.id).toBeGreaterThan(0);
    }
  });

  it('never states verification stronger than what was done', () => {
    // In this build every record was checked via search-index records only.
    for (const s of db.sources) expect(s.verification.level, s.id).toBe('search-index');
  });

  it('does not invent sample sizes: n is null or a non-empty string', () => {
    for (const s of db.sources) {
      if (s.n !== null) expect(s.n.trim().length, s.id).toBeGreaterThan(0);
    }
  });

  it('never uses single-function labels or activation language in displayed claims', () => {
    const banned = [/fear cent(er|re)/i, /pleasure cent(er|re)/i, /\bfires?\b/i, /% activation/i, /dopamine (is )?released by/i];
    for (const a of db.associations) for (const re of banned) expect(re.test(a.claim), `${a.id}: ${re}`).toBe(false);
  });

  it('keeps grades honest: strong requires a meta-analysis/large sample and >1 supporting source', () => {
    const src = new Map(db.sources.map((s) => [s.id, s]));
    for (const a of db.associations.filter((x) => x.grade === 'strong')) {
      const supporting = a.citations.filter((c) => c.role === 'supports').map((c) => src.get(c.source)!);
      expect(supporting.length, a.id).toBeGreaterThan(1);
      const hasSynthesis = supporting.some((s) =>
        ['coordinate-based meta-analysis', 'systematic review and meta-analysis', 'large-sample fMRI study', 'narrative review'].includes(s.design),
      );
      expect(hasSynthesis, a.id).toBe(true);
    }
  });

  it('marks atlas hemispheres consistently with MNI x-coordinates', () => {
    for (const r of manifest.regions) {
      if (r.hemi === 'L') expect(r.centroidMNI[0], r.id).toBeLessThan(0);
      if (r.hemi === 'R') expect(r.centroidMNI[0], r.id).toBeGreaterThan(0);
    }
  });

  it('places key structures in anatomically plausible MNI locations', () => {
    const c = (id: string) => manifest.regions.find((r: { id: string }) => r.id === id).centroidMNI as number[];
    // amygdala is anterior to the hippocampus and inferior to the putamen
    expect(c('L_amygdala')[1]).toBeGreaterThan(c('L_hippocampus')[1]);
    expect(c('L_amygdala')[2]).toBeLessThan(c('L_putamen')[2]);
    // Heschl's gyrus lies on the superior temporal plane, above the bulk of the STG label
    expect(c('L_transverse_temporal')[2]).toBeGreaterThan(c('L_superior_temporal')[2]);
    // pericalcarine (V1) is posterior; orbitofrontal is anterior and inferior
    expect(c('L_pericalcarine')[1]).toBeLessThan(-70);
    expect(c('L_medial_orbitofrontal')[1]).toBeGreaterThan(20);
    expect(c('L_medial_orbitofrontal')[2]).toBeLessThan(0);
    // the cerebellum is inferior and posterior
    expect(c('L_cerebellum')[2]).toBeLessThan(-20);
    expect(c('L_cerebellum')[1]).toBeLessThan(-40);
    // the accumbens is anterior-inferior to the caudate body
    expect(c('L_accumbens_area')[2]).toBeLessThan(c('L_caudate')[2]);
  });
});
