import type { Applicability, DetectionConfidence, EvidenceDB, EvidenceGrade, FeatureId } from '../evidence/types';
import { mapSegment } from '../pipeline/mapping';
import type { ListenerContext, Segment, TimelineTracks, TranscriptCue } from '../pipeline/types';

/**
 * The estimated heat map.
 *
 * Heat is NOT a measurement or prediction of brain activity. For each moment it combines
 *   (a) how much of each detected kind of input the media contains right then
 *       (loudness, speech- and music-likeness, beat, motion, faces, cuts, words), and
 *   (b) the curated research associations that link that kind of input to brain areas,
 *       weighted by evidence grade, how directly the research applies, listener conditions
 *       and detection confidence.
 * An area can only heat up through an association the evidence pipeline (mapSegment) reached,
 * so everything with insufficient evidence stays cold.
 */

export interface HeatSystem {
  id: string;
  name: string;
  processes: string[];
}

/** Brain systems shown as traces, grouped by the research process they come from. */
export const SYSTEMS: HeatSystem[] = [
  { id: 'hearing', name: 'Hearing', processes: ['auditory_processing', 'loudness_coding', 'acoustic_onset_detection'] },
  { id: 'voice', name: 'Voices', processes: ['voice_perception'] },
  { id: 'language', name: 'Language', processes: ['language_comprehension', 'semantic_processing', 'narrative_integration', 'mentalizing'] },
  { id: 'music', name: 'Music & beat', processes: ['music_selective_processing', 'song_perception', 'beat_perception', 'music_evoked_reward', 'music_structure_language_overlap'] },
  { id: 'vision', name: 'Vision', processes: ['visual_processing', 'visual_change_early', 'scene_perception'] },
  { id: 'motion', name: 'Motion', processes: ['visual_motion'] },
  { id: 'faces', name: 'Faces', processes: ['face_perception'] },
  {
    id: 'attention',
    name: 'Attention & surprise',
    processes: ['salient_change_orienting', 'event_segmentation', 'suspense_attention', 'narrative_surprise', 'humor_comprehension', 'humor_appreciation'],
  },
];

const SYSTEM_OF = new Map(SYSTEMS.flatMap((s, i) => s.processes.map((p) => [p, i] as const)));

export const GRADE_WEIGHT: Record<EvidenceGrade, number> = { strong: 1, moderate: 0.8, limited: 0.55, contested: 0.35 };
export const APPLICABILITY_WEIGHT: Record<Applicability, number> = { direct: 1, partial: 0.75, extrapolation: 0.5 };
const CONFIDENCE_WEIGHT: Record<DetectionConfidence, number> = { high: 1, moderate: 0.85, low: 0.65 };
const CONDITIONAL_WEIGHT = 0.7;

interface Hit {
  meshId: string;
  feature: FeatureId;
  /** index into SYSTEMS, or -1 */
  system: number;
  /** key for one association reached through one feature */
  key: string;
  weight: number;
}

interface SegmentHits {
  start: number;
  end: number;
  hits: Hit[];
  /** feature ids present in this segment */
  present: Set<FeatureId>;
}

export interface HeatModel {
  duration: number;
  /** step (s) of the precomputed system traces */
  step: number;
  /** traces[systemIndex][i] = system heat at i * step */
  traces: Float32Array[];
  /** heat per mesh at time t (0..1); meshes without heat are absent */
  meshHeat(t: number, out: Map<string, number>): Map<string, number>;
  /** heat per system at time t, in SYSTEMS order */
  systemHeat(t: number): number[];
  /** the driver (0..1) of one feature at time t - how much of that input the media has right then */
  driver(feature: FeatureId, t: number): number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Several findings for one area: the strongest counts fully, the others add a little. */
const combine = (max: number, sum: number) => clamp01(max + 0.15 * (sum - max));

function sample(values: number[] | undefined, step: number, t: number): number | undefined {
  if (!values?.length) return undefined;
  const x = t / step;
  const i = Math.floor(x);
  if (i < 0) return values[0];
  if (i >= values.length - 1) return values[values.length - 1];
  const f = x - i;
  return values[i] * (1 - f) + values[i + 1] * f;
}

/** Decaying impulse after the most recent event at or before t. */
function impulse(events: number[] | undefined, t: number, tau: number): number {
  if (!events?.length) return 0;
  let lo = 0;
  let hi = events.length - 1;
  if (events[0] > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (events[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const dt = t - events[lo];
  return dt > tau * 5 ? 0 : Math.exp(-dt / tau);
}

export function buildHeatModel(db: EvidenceDB, segments: Segment[], tracks: TimelineTracks, cues: TranscriptCue[], ctx: ListenerContext, duration: number): HeatModel {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const cueActive = (t: number) => {
    // binary search for the last cue starting at or before t
    let lo = 0;
    let hi = sorted.length - 1;
    if (!sorted.length || sorted[0].start > t) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sorted[mid].start <= t) lo = mid;
      else hi = mid - 1;
    }
    // cues can overlap: look back a few
    for (let i = lo; i >= Math.max(0, lo - 3); i--) if (sorted[i].end > t) return 1;
    return 0;
  };

  const hasAudio = !!tracks.level?.length || !!tracks.fine?.db.length;
  // Loudness relative to the file's own quiet-to-loud range, so a loud song still rises and falls;
  // anything near silence counts as nothing.
  const dbSeries = tracks.fine?.db ?? tracks.level ?? [];
  const audible = dbSeries.filter((d) => d > -55).sort((a, b) => a - b);
  const lo = audible.length ? Math.max(-55, audible[Math.floor(audible.length * 0.05)] - 6) : 0;
  const hi = audible.length ? Math.max(lo + 6, audible[Math.floor(audible.length * 0.98)]) : 1;
  const loud = (t: number) => {
    const d = tracks.fine ? sample(tracks.fine.db, tracks.fine.step, t) : sample(tracks.level, tracks.step, t);
    if (d === undefined || d <= -55 || !audible.length) return 0;
    return clamp01((d - lo) / (hi - lo));
  };
  const punch = (t: number) => (tracks.fine ? (sample(tracks.fine.punch, tracks.fine.step, t) ?? 0) : 0);
  const track = (v: number[] | undefined, t: number) => sample(v, tracks.step, t) ?? 0;

  // Segment-level hits from the evidence pipeline; only what mapSegment reaches can carry heat.
  const segs: SegmentHits[] = segments.map((s) => {
    const m = mapSegment(db, s, ctx);
    const hits: Hit[] = [];
    for (const r of m.meshes.values()) {
      for (const h of r.hits) {
        const f = s.features[h.feature.id];
        const conf = f?.status === 'confirmed' ? 1 : CONFIDENCE_WEIGHT[f?.confidence ?? 'moderate'];
        hits.push({
          meshId: r.meshId,
          feature: h.feature.id,
          system: SYSTEM_OF.get(h.association.process) ?? -1,
          key: `${h.association.id}|${h.feature.id}`,
          weight: GRADE_WEIGHT[h.association.grade] * APPLICABILITY_WEIGHT[h.applicability] * (h.conditional ? CONDITIONAL_WEIGHT : 1) * conf,
        });
      }
    }
    const present = new Set(Object.values(s.features).flatMap((f) => (f?.present && f.status !== 'rejected' ? [f.id] : [])));
    return { start: s.start, end: s.end, hits, present };
  });
  const segAt = (t: number): SegmentHits | undefined => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < segs[mid].start) hi = mid - 1;
      else if (t >= segs[mid].end) lo = mid + 1;
      else return segs[mid];
    }
    return t >= duration && segs.length ? segs[segs.length - 1] : undefined;
  };

  /** How much of one kind of input the media contains at time t (0..1). */
  const driver = (feature: FeatureId, t: number): number => {
    switch (feature) {
      case 'sound_present':
        return loud(t) * (0.75 + 0.25 * punch(t));
      case 'speech_present':
        // from audio when analysed, otherwise from the timed transcript
        return hasAudio ? loud(t) * clamp01(Math.max(track(tracks.speech, t), 0.6 * cueActive(t))) : cueActive(t);
      case 'music_present':
      case 'singing_possible':
        return loud(t) * track(tracks.music, t);
      case 'regular_beat':
        return loud(t) * track(tracks.music, t) * (0.55 + 0.45 * punch(t));
      case 'loudness_change':
        return clamp01(0.5 * loud(t) + 0.5 * punch(t));
      case 'abrupt_onset':
        return impulse(tracks.onsets, t, 1.2);
      case 'transcribed_speech':
      case 'narrative_cues':
      case 'mental_state_language':
      case 'laughter_marker':
      case 'emotion_words':
        return cueActive(t) ? 1 : 0.35;
      case 'visual_input':
        return 0.5 + 0.3 * track(tracks.motion, t) + 0.2 * impulse(tracks.cuts, t, 1.0);
      case 'visual_motion':
        return track(tracks.motion, t);
      case 'luminance_change':
        return 0.6;
      case 'scene_cut':
        return impulse(tracks.cuts, t, 1.0);
      case 'faces_visible':
        return tracks.faces ? track(tracks.faces, t) : 0.7;
      default:
        // confirmed interpretations and places: constant within the segment where they were marked
        return 1;
    }
  };

  const sums = new Map<string, { max: number; sum: number }>();
  const meshHeat = (t: number, out: Map<string, number>) => {
    out.clear();
    sums.clear();
    const seg = segAt(t);
    if (!seg) return out;
    const cache = new Map<FeatureId, number>();
    for (const h of seg.hits) {
      let d = cache.get(h.feature);
      if (d === undefined) {
        d = clamp01(driver(h.feature, t));
        cache.set(h.feature, d);
      }
      const v = h.weight * d;
      if (v <= 0) continue;
      const cur = sums.get(h.meshId);
      if (cur) {
        cur.max = Math.max(cur.max, v);
        cur.sum += v;
      } else sums.set(h.meshId, { max: v, sum: v });
    }
    for (const [mesh, { max, sum }] of sums) out.set(mesh, combine(max, sum));
    return out;
  };

  const systemHeat = (t: number): number[] => {
    const max = SYSTEMS.map(() => 0);
    const sum = SYSTEMS.map(() => 0);
    const seg = segAt(t);
    if (!seg) return max;
    const seen = new Set<string>();
    for (const h of seg.hits) {
      if (h.system < 0 || seen.has(h.key)) continue;
      seen.add(h.key);
      const v = h.weight * clamp01(driver(h.feature, t));
      max[h.system] = Math.max(max[h.system], v);
      sum[h.system] += v;
    }
    return max.map((m, i) => combine(m, sum[i]));
  };

  const step = 0.1;
  const n = Math.max(1, Math.ceil(duration / step) + 1);
  const traces = SYSTEMS.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const v = systemHeat(i * step);
    for (let k = 0; k < v.length; k++) traces[k][i] = v[k];
  }

  return { duration, step, traces, meshHeat, systemHeat, driver };
}

/** Qualitative words for heat, so numbers are not read as measurements. */
export function heatWord(v: number): string {
  return v >= 0.66 ? 'High' : v >= 0.33 ? 'Medium' : v > 0.05 ? 'Low' : 'None';
}
