import sources from '../../data/evidence/sources.json';
import regions from '../../data/evidence/regions.json';
import networks from '../../data/evidence/networks.json';
import processes from '../../data/evidence/processes.json';
import associations from '../../data/evidence/associations.json';
import features from '../../data/evidence/features.json';
import rules from '../../data/evidence/rules.json';
import unsupported from '../../data/evidence/unsupported.json';
import meta from '../../data/evidence/meta.json';
import type { EvidenceDB, SourceRecord, RegionRecord, NetworkRecord, ProcessRecord, FeatureDefinition, FeatureId } from './types';

/**
 * The evidence database is plain JSON under data/evidence/ so it can be reviewed and
 * updated without touching the interface. It is validated by tests/evidence.test.ts
 * and at startup (see validate.ts).
 */
export const db = {
  sources,
  regions,
  networks,
  processes,
  associations,
  features,
  rules,
  unsupported,
  meta,
} as unknown as EvidenceDB;

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

export const sourceById: Map<string, SourceRecord> = byId(db.sources);
export const regionById: Map<string, RegionRecord> = byId(db.regions);
export const networkById: Map<string, NetworkRecord> = byId(db.networks);
export const processById: Map<string, ProcessRecord> = byId(db.processes);
export const featureById = byId(db.features) as Map<FeatureId, FeatureDefinition>;

/** mesh id -> region/network record and hemisphere */
export const meshIndex = (() => {
  const m = new Map<string, { kind: 'region' | 'network'; id: string; hemi: 'L' | 'R' | 'bilateral' }>();
  for (const r of db.regions) {
    for (const [hemi, mesh] of Object.entries(r.meshes)) {
      if (mesh) m.set(mesh, { kind: 'region', id: r.id, hemi: hemi as 'L' | 'R' | 'bilateral' });
    }
  }
  for (const n of db.networks) {
    m.set(n.meshes.L, { kind: 'network', id: n.id, hemi: 'L' });
    m.set(n.meshes.R, { kind: 'network', id: n.id, hemi: 'R' });
  }
  return m;
})();
