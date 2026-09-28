import type {
  Applicability,
  Association,
  AssociationTarget,
  DetectionConfidence,
  EvidenceDB,
  EvidenceGrade,
  FeatureId,
  FeatureRule,
  UnsupportedMapping,
} from '../evidence/types';
import type { DetectedFeature, ListenerContext, Segment } from './types';

/**
 * The auditable pipeline:
 *   detected feature --(rule)--> candidate process --(association)--> region / network
 *
 * Nothing in this module invents a mapping: region results can only come from an
 * Association record in the evidence database, and associations can only be reached
 * through a FeatureRule. Processes with no association produce an explicit
 * 'insufficient evidence' result instead of a highlight.
 */

const CONF_RANK: Record<DetectionConfidence, number> = { low: 0, moderate: 1, high: 2 };
export const GRADE_RANK: Record<EvidenceGrade, number> = { strong: 3, moderate: 2, limited: 1, contested: 0 };

export type RuleOutcome =
  | { kind: 'fired' }
  | { kind: 'feature-absent' }
  | { kind: 'rejected-by-user' }
  | { kind: 'needs-confirmation' }
  | { kind: 'below-confidence'; needed: DetectionConfidence; had: DetectionConfidence }
  | { kind: 'listener-context'; key: string };

export interface ProcessStep {
  rule: FeatureRule;
  feature: DetectedFeature;
  outcome: RuleOutcome;
  /** associations reached when fired */
  associations: Association[];
  /** explicit "insufficient evidence" record(s) when no association exists */
  unsupported: UnsupportedMapping[];
  /** true when the rule depends on listener conditions that are still 'unknown' */
  conditional: boolean;
}

export interface TargetHit {
  association: Association;
  target: AssociationTarget;
  rule: FeatureRule;
  feature: DetectedFeature;
  applicability: Applicability;
  conditional: boolean;
}

export interface MeshResult {
  meshId: string;
  kind: 'region' | 'network';
  id: string;
  hemi: 'L' | 'R' | 'bilateral';
  /** highest non-contested grade; 'contested' only when every hit is contested */
  grade: EvidenceGrade;
  hits: TargetHit[];
}

export interface SegmentMap {
  segmentId: string;
  steps: ProcessStep[];
  meshes: Map<string, MeshResult>;
  /** Unsupported-mapping notes triggered by detected features (e.g. tempo values). */
  featureNotes: UnsupportedMapping[];
}

export function ruleOutcome(rule: FeatureRule, f: DetectedFeature | undefined, ctx: ListenerContext): RuleOutcome {
  if (!f || !f.present) return { kind: 'feature-absent' };
  if (f.status === 'rejected') return { kind: 'rejected-by-user' };
  for (const key of rule.conditionKeys ?? []) {
    if (ctx[key] === 'no') return { kind: 'listener-context', key };
  }
  if (f.status === 'confirmed') return { kind: 'fired' };
  if (rule.requiresConfirmation || f.status === 'suggested') return { kind: 'needs-confirmation' };
  if (CONF_RANK[f.confidence] < CONF_RANK[rule.minConfidence]) {
    return { kind: 'below-confidence', needed: rule.minConfidence, had: f.confidence };
  }
  return { kind: 'fired' };
}

function meshesForTarget(db: EvidenceDB, t: AssociationTarget): { meshId: string; hemi: 'L' | 'R' | 'bilateral' }[] {
  if (t.kind === 'network') {
    const n = db.networks.find((x) => x.id === t.id);
    if (!n) return [];
    const hemis: ('L' | 'R')[] = t.hemi === 'L' ? ['L'] : t.hemi === 'R' ? ['R'] : ['L', 'R'];
    return hemis.map((h) => ({ meshId: n.meshes[h], hemi: h }));
  }
  const r = db.regions.find((x) => x.id === t.id);
  if (!r) return [];
  const m = r.meshes as Record<string, string | undefined>;
  if (m.bilateral) return [{ meshId: m.bilateral, hemi: 'bilateral' }];
  const hemis: ('L' | 'R')[] = t.hemi === 'L' ? ['L'] : t.hemi === 'R' ? ['R'] : ['L', 'R'];
  return hemis.filter((h) => m[h]).map((h) => ({ meshId: m[h]!, hemi: h }));
}

export function bestGrade(grades: EvidenceGrade[]): EvidenceGrade {
  const nonContested = grades.filter((g) => g !== 'contested');
  if (!nonContested.length) return 'contested';
  return nonContested.reduce((a, b) => (GRADE_RANK[b] > GRADE_RANK[a] ? b : a));
}

export function mapSegment(db: EvidenceDB, segment: Segment, ctx: ListenerContext): SegmentMap {
  const steps: ProcessStep[] = [];
  const meshes = new Map<string, MeshResult>();

  for (const rule of db.rules) {
    const feature = segment.features[rule.feature as FeatureId];
    const outcome = ruleOutcome(rule, feature, ctx);
    if (outcome.kind === 'feature-absent' || !feature) continue;
    const conditional = (rule.conditionKeys ?? []).some((k) => ctx[k] === 'unknown');
    const associations = outcome.kind === 'fired' ? db.associations.filter((a) => a.process === rule.process) : [];
    const unsupported =
      outcome.kind === 'fired' && associations.length === 0
        ? db.unsupported.filter((u) => u.appliesTo.processes?.includes(rule.process))
        : [];
    steps.push({ rule, feature, outcome, associations, unsupported, conditional });

    for (const association of associations) {
      for (const target of association.targets) {
        for (const { meshId, hemi } of meshesForTarget(db, target)) {
          const hit: TargetHit = { association, target, rule, feature, applicability: rule.applicability, conditional };
          const existing = meshes.get(meshId);
          if (existing) {
            existing.hits.push(hit);
            existing.grade = bestGrade(existing.hits.map((h) => h.association.grade));
          } else {
            meshes.set(meshId, { meshId, kind: target.kind, id: target.id, hemi, grade: association.grade, hits: [hit] });
          }
        }
      }
    }
  }

  const presentFeatures = new Set(
    Object.values(segment.features)
      .filter((f): f is DetectedFeature => !!f && f.present && f.status !== 'rejected')
      .map((f) => f.id),
  );
  const featureNotes = db.unsupported.filter((u) => u.appliesTo.features?.some((f) => presentFeatures.has(f)));

  return { segmentId: segment.id, steps, meshes, featureNotes };
}

export const DEFAULT_CONTEXT: ListenerContext = {
  understands_language: 'unknown',
  enjoys_music: 'unknown',
  finds_funny: 'unknown',
};
