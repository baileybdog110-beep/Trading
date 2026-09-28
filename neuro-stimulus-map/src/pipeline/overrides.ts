import type { FeatureId } from '../evidence/types';
import type { DetectedFeature, Segment } from './types';

/** User corrections, keyed by segment id then feature id. They always win over detection. */
export type Overrides = Record<string, Partial<Record<FeatureId, DetectedFeature>>>;

export function applyOverrides(segments: Segment[], overrides: Overrides): Segment[] {
  return segments.map((s) => {
    const o = overrides[s.id];
    return o ? { ...s, features: { ...s.features, ...o } } : s;
  });
}

export function confirmFeature(current: DetectedFeature | undefined, id: FeatureId): DetectedFeature {
  if (current && current.present) return { ...current, status: 'confirmed' };
  return { id, present: true, confidence: 'high', status: 'confirmed', source: 'user', measurement: 'Marked present by you.' };
}

export function rejectFeature(current: DetectedFeature | undefined, id: FeatureId): DetectedFeature {
  return current
    ? { ...current, status: 'rejected' }
    : { id, present: false, confidence: 'high', status: 'rejected', source: 'user', measurement: 'Marked absent by you.' };
}
