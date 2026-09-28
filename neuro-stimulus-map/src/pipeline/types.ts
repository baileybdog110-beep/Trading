import type { DetectionConfidence, FeatureId, ListenerConditionKey } from '../evidence/types';

export type FeatureStatus =
  /** produced by an automatic detector */
  | 'auto'
  /** a person confirmed or added it */
  | 'confirmed'
  /** a person rejected it (overrides detection) */
  | 'rejected'
  /** proposed by a cue or optional language model; ignored until confirmed */
  | 'suggested';

export type FeatureSource = 'audio' | 'video' | 'transcript' | 'user' | 'llm' | 'demo';

export interface DetectedFeature {
  id: FeatureId;
  present: boolean;
  /** Detection confidence (how sure we are the feature is in the media) - separate from evidence strength. */
  confidence: DetectionConfidence;
  status: FeatureStatus;
  source: FeatureSource;
  /** What was measured, in plain words. */
  measurement: string;
  values?: Record<string, number | string>;
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface Segment {
  id: string;
  index: number;
  start: number;
  end: number;
  label: string;
  features: Partial<Record<FeatureId, DetectedFeature>>;
  cues: TranscriptCue[];
}

export type ModalityState =
  | { state: 'analyzed'; detail: string }
  | { state: 'not-present'; detail: string }
  | { state: 'not-analyzed'; detail: string }
  | { state: 'failed'; detail: string };

export interface Modalities {
  audio: ModalityState;
  video: ModalityState;
  faces: ModalityState;
  transcript: ModalityState & { timed?: boolean; origin?: 'file' | 'local-asr' | 'demo' };
}

export type ListenerContext = Record<ListenerConditionKey, 'unknown' | 'yes' | 'no'>;

/** Frame-level summaries kept for the timeline lanes (downsampled). */
export interface TimelineTracks {
  /** seconds per value */
  step: number;
  level?: number[]; // dBFS
  speech?: number[]; // 0..1 score
  music?: number[]; // 0..1 score
  motion?: number[]; // 0..1
  faces?: number[]; // 0/1 per video sample (resampled)
  onsets?: number[]; // times (s)
  cuts?: number[]; // times (s)
}

export interface AnalysisSession {
  id: string;
  isDemo: boolean;
  mediaName: string;
  mediaKind: 'video' | 'audio' | 'none';
  duration: number;
  createdAt: string;
  modalities: Modalities;
  segments: Segment[];
  tracks: TimelineTracks;
  untimedTranscript?: string;
  notes: string[];
}
