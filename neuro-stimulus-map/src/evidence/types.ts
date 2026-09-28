/**
 * Types for the curated evidence database (data/evidence/*.json).
 *
 * The chain the app displays is always:
 *   detected feature --(FeatureRule)--> candidate process --(Association)--> region/network
 * and every Association must cite at least one SourceRecord with role "supports".
 */

export type EvidenceGrade = 'strong' | 'moderate' | 'limited' | 'contested';
/** How closely a research finding applies to a detected feature in uploaded media. */
export type Applicability = 'direct' | 'partial' | 'extrapolation';
export type Hemi = 'L' | 'R' | 'both' | 'bilateral';

export type StudyDesign =
  | 'coordinate-based meta-analysis'
  | 'systematic review and meta-analysis'
  | 'narrative review'
  | 'large-sample fMRI study'
  | 'fMRI study'
  | 'naturalistic fMRI study'
  | 'PET study'
  | 'intracranial recording study'
  | 'methods / database'
  | 'atlas';

export interface Verification {
  /**
   * 'search-index': existence and bibliographic details confirmed from search-engine records that
   *   point to PubMed / publisher pages; findings checked against abstract-level excerpts only.
   * 'abstract': abstract read directly on PubMed or the publisher page.
   * 'full-text': the relevant sections of the full text were read.
   */
  level: 'search-index' | 'abstract' | 'full-text';
  checkedOn: string;
  via: string[];
  notes?: string;
}

export interface SourceRecord {
  id: string;
  shortCite: string;
  authors: string;
  year: number;
  title: string;
  venue: string;
  /** Volume/issue/pages exactly as verified; omitted when not verified. */
  details?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  url: string;
  design: StudyDesign;
  method: string;
  population: string;
  /** Sample size as reported; null when it could not be verified in this environment. */
  n: string | null;
  stimuli: string;
  comparison: string;
  keyFindings: string[];
  limitations: string[];
  naturalistic: boolean;
  verification: Verification;
}

export interface RegionRecord {
  id: string;
  name: string;
  /** Mesh ids in public/atlas/cerebra.glb */
  meshes: Partial<Record<'L' | 'R' | 'bilateral', string>>;
  lobe: string;
  kind: 'cortical' | 'subcortical' | 'cerebellar' | 'brainstem';
  /** Orientation text only. Never used to create a mapping. */
  orientation: string;
  /** Reminder that regions are multifunctional. */
  multifunction: string;
}

export interface NetworkRecord {
  id: string;
  name: string;
  meshes: { L: string; R: string };
  orientation: string;
}

export interface ProcessRecord {
  id: string;
  name: string;
  level: 'sensory' | 'perceptual' | 'cognitive' | 'affective' | 'interpretive';
  description: string;
}

export interface AssociationTarget {
  kind: 'region' | 'network';
  id: string;
  hemi: Hemi;
  /**
   * 'atlas': the finding concerns the gyral/structural region itself.
   * 'approximate': a functional area (e.g. FFA, MT+, SMA, TPJ) that lies within or across
   *   the atlas region(s) shown; the highlight is broader than the finding.
   */
  precision: 'atlas' | 'approximate';
  functionalLabel?: string;
  note?: string;
}

export interface CitedFinding {
  source: string;
  role: 'supports' | 'qualifies' | 'conflicts';
  /** What this source actually found, in plain language, relevant to this association. */
  finding: string;
}

export interface Association {
  id: string;
  process: string;
  targets: AssociationTarget[];
  /** The exact claim shown to the user. */
  claim: string;
  grade: EvidenceGrade;
  gradeRationale: {
    consistency: string;
    quality: string;
    directness: string;
    replication: string;
  };
  citations: CitedFinding[];
  limitations: string[];
}

export type FeatureId =
  | 'sound_present'
  | 'speech_present'
  | 'music_present'
  | 'singing_possible'
  | 'regular_beat'
  | 'loudness_change'
  | 'abrupt_onset'
  | 'transcribed_speech'
  | 'narrative_cues'
  | 'mental_state_language'
  | 'laughter_marker'
  | 'emotion_words'
  | 'visual_input'
  | 'visual_motion'
  | 'luminance_change'
  | 'scene_cut'
  | 'faces_visible'
  | 'places_layout'
  | 'situation_change'
  | 'humor'
  | 'suspense'
  | 'surprise'
  | 'emotional_theme';

export type Modality = 'audio' | 'transcript' | 'video' | 'user';

export interface FeatureDefinition {
  id: FeatureId;
  name: string;
  modality: Modality;
  /** 'observation' = measured from the signal; 'interpretation' = inferred meaning, needs review. */
  kind: 'observation' | 'interpretation';
  howDetected: string;
  limitations: string;
}

export interface FeatureRule {
  id: string;
  feature: FeatureId;
  process: string;
  applicability: Applicability;
  rationale: string;
  /** Conditions about the person that the research assumed; shown as caveats. */
  conditions: string[];
  /** Listener-context switches that can suppress this rule when answered 'no'. */
  conditionKeys: ListenerConditionKey[];
  /** Lowest automatic detection confidence at which the rule fires (user-confirmed features always pass). */
  minConfidence: DetectionConfidence;
  /** If true the rule only fires once a person has confirmed the feature. */
  requiresConfirmation: boolean;
}

export type DetectionConfidence = 'low' | 'moderate' | 'high';

export interface UnsupportedMapping {
  id: string;
  /** What a user might expect to see mapped. */
  topic: string;
  appliesTo: { features?: FeatureId[]; processes?: string[] };
  reason: string;
  sources: string[];
}

export interface EvidenceDB {
  sources: SourceRecord[];
  regions: RegionRecord[];
  networks: NetworkRecord[];
  processes: ProcessRecord[];
  associations: Association[];
  features: FeatureDefinition[];
  rules: FeatureRule[];
  unsupported: UnsupportedMapping[];
  meta: {
    version: string;
    curatedOn: string;
    gradingRubric: Record<EvidenceGrade | 'insufficient', string>;
    applicabilityRubric: Record<Applicability, string>;
    verificationStatement: string;
  };
}

export type ListenerConditionKey = 'understands_language' | 'enjoys_music' | 'finds_funny';
