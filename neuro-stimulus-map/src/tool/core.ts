/**
 * Tool core: the same evidence database, mapping rules and analysis code as the web app,
 * exposed as plain functions that other AI systems can call (via MCP, HTTP or CLI).
 *
 * Every result carries the same guarantees as the app:
 *  - it is a research-based association map, never a measurement of anyone's brain;
 *  - regions only appear through curated, cited evidence records;
 *  - unsupported inputs return explicit "insufficient evidence" records;
 *  - modalities that were not analysed are reported, never guessed.
 * No DOM or browser APIs are used here.
 */
import { finishAudioAnalysis } from '../analysis/audio/analyze';
import { ANALYSIS_RATE, FrameAnalyzer } from '../analysis/audio/dsp';
import { Resampler, parseWavHeader, pcmToMono } from '../analysis/audio/wav';
import { assemble } from '../analysis/assemble';
import { parseTranscript } from '../analysis/transcript/parse';
import { db, featureById, meshIndex, networkById, processById, regionById, sourceById } from '../evidence/db';
import type { Association, DetectionConfidence, EvidenceGrade, FeatureId, ListenerConditionKey } from '../evidence/types';
import { DEFAULT_CONTEXT, mapSegment, type SegmentMap } from '../pipeline/mapping';
import type { DetectedFeature, ListenerContext, Segment, TranscriptCue } from '../pipeline/types';

export const TOOL_NAME = 'stimulus-association-map';
export const TOOL_VERSION = '0.2.0';

export const DISCLAIMER =
  'Research-based stimulus association map - NOT a brain scan. Results say which brain regions published research associates with the kinds of stimuli described; they do not measure, predict or simulate any person\'s brain activity, and they never indicate dopamine, hormones, emotions or activation levels. Evidence grades describe the research, not this media; applying a finding to specific content is often an extrapolation.';

export class ToolInputError extends Error {}

// ---------- shared shapes ----------

export interface FeatureInput {
  id: string;
  present?: boolean;
  confidence?: DetectionConfidence;
  /** true when a person has confirmed the feature (required for interpretive features such as humor) */
  confirmed?: boolean;
  note?: string;
}

const CONF = new Set(['low', 'moderate', 'high']);
const LISTENER_KEYS: ListenerConditionKey[] = ['understands_language', 'enjoys_music', 'finds_funny'];

function listenerContext(input?: Partial<Record<string, unknown>>): ListenerContext {
  const ctx: ListenerContext = { ...DEFAULT_CONTEXT };
  for (const k of LISTENER_KEYS) {
    const v = input?.[k];
    if (v === undefined) continue;
    if (v !== 'unknown' && v !== 'yes' && v !== 'no') throw new ToolInputError(`listenerContext.${k} must be "unknown", "yes" or "no"`);
    ctx[k] = v;
  }
  return ctx;
}

function citation(id: string) {
  const s = sourceById.get(id);
  if (!s) return { id, citation: 'unknown source' };
  return {
    id: s.id,
    citation: `${s.authors} (${s.year}). ${s.title}. ${s.venue}${s.details ? ', ' + s.details : ''}.`,
    doi: s.doi,
    pmid: s.pmid,
    url: s.url,
    design: s.design,
    sampleSize: s.n,
    naturalistic: s.naturalistic,
    verification: `${s.verification.level} (${s.verification.checkedOn})`,
  };
}

function targetSummary(a: Association) {
  return a.targets.map((t) => ({
    kind: t.kind,
    id: t.id,
    name: t.kind === 'region' ? regionById.get(t.id)?.name : networkById.get(t.id)?.name,
    hemisphere: t.hemi,
    precision: t.precision,
    functionalLabel: t.functionalLabel,
    note: t.note,
  }));
}

export function associationSummary(a: Association) {
  return {
    id: a.id,
    process: processById.get(a.process)?.name ?? a.process,
    claim: a.claim,
    evidenceGrade: a.grade,
    gradeRationale: a.gradeRationale,
    targets: targetSummary(a),
    sources: a.citations.map((c) => ({ role: c.role, finding: c.finding, ...citation(c.source) })),
    limitations: a.limitations,
  };
}

function meshName(meshId: string) {
  const info = meshIndex.get(meshId);
  if (!info) return meshId;
  const hemi = info.hemi === 'bilateral' ? '' : info.hemi === 'L' ? 'Left ' : 'Right ';
  return `${hemi}${info.kind === 'region' ? regionById.get(info.id)?.name : networkById.get(info.id)?.name}`;
}

const OUTCOME_TEXT: Record<string, string> = {
  fired: 'applied',
  'rejected-by-user': 'not applied: feature rejected',
  'needs-confirmation': 'not applied: this interpretation must be confirmed by a person (set confirmed: true)',
  'below-confidence': 'not applied: detection confidence below the rule minimum',
  'listener-context': 'not applied: the listener condition was answered "no"',
};

/** Convert a segment mapping into a compact, self-explanatory JSON result. */
export function summarizeMap(m: SegmentMap) {
  const processes = m.steps.map((s) => ({
    feature: s.rule.feature,
    featureName: featureById.get(s.rule.feature)?.name,
    process: s.rule.process,
    processName: processById.get(s.rule.process)?.name,
    outcome: OUTCOME_TEXT[s.outcome.kind] ?? s.outcome.kind,
    applicability: s.rule.applicability,
    dependsOnListener: s.conditional,
    assumptions: s.rule.conditions,
    rationale: s.rule.rationale,
    associations: s.associations.map((a) => ({ id: a.id, evidenceGrade: a.grade, claim: a.claim })),
    insufficientEvidence: s.unsupported.map((u) => ({ topic: u.topic, reason: u.reason })),
  }));
  const regions = [...m.meshes.values()]
    .map((r) => ({
      meshId: r.meshId,
      name: meshName(r.meshId),
      kind: r.kind,
      summary: (r.kind === 'region' ? regionById.get(r.id)?.summary : networkById.get(r.id)?.summary) ?? '',
      hemisphere: r.hemi,
      bestEvidenceGrade: r.grade,
      approximate: r.hits.some((h) => h.target.precision === 'approximate'),
      functionalLabels: [...new Set(r.hits.map((h) => h.target.functionalLabel).filter(Boolean))],
      viaProcesses: [...new Set(r.hits.map((h) => processById.get(h.association.process)?.name))],
      associationIds: [...new Set(r.hits.map((h) => h.association.id))],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const used = new Set(m.steps.flatMap((s) => s.associations.map((a) => a.id)));
  return {
    processes,
    regions,
    associations: db.associations.filter((a) => used.has(a.id)).map(associationSummary),
    notMappedOnPurpose: m.featureNotes.map((u) => ({ topic: u.topic, reason: u.reason })),
  };
}

// ---------- tools ----------

export function describeTool() {
  return {
    name: TOOL_NAME,
    version: TOOL_VERSION,
    evidenceDbVersion: db.meta.version,
    disclaimer: DISCLAIMER,
    verificationStatement: db.meta.verificationStatement,
    gradingRubric: db.meta.gradingRubric,
    applicabilityRubric: db.meta.applicabilityRubric,
    counts: { sources: db.sources.length, associations: db.associations.length, rules: db.rules.length, unsupportedMappings: db.unsupported.length },
    pipeline: 'detected media features -> reviewed rules -> candidate processes -> curated, cited associations -> regions/networks',
    anatomy: 'CerebrA atlas (CC BY 4.0) regions; Yeo 7-network layout via Schaefer 2018 (MIT).',
  };
}

export function listVocabulary() {
  return {
    features: db.features.map((f) => ({ id: f.id, name: f.name, modality: f.modality, kind: f.kind, howDetected: f.howDetected, limitations: f.limitations })),
    processes: db.processes.map((p) => ({ id: p.id, name: p.name, level: p.level, description: p.description })),
    regions: db.regions.map((r) => ({ id: r.id, name: r.name, lobe: r.lobe, kind: r.kind, hemispheres: Object.keys(r.meshes) })),
    networks: db.networks.map((n) => ({ id: n.id, name: n.name })),
    listenerContextKeys: LISTENER_KEYS,
    confidenceLevels: ['low', 'moderate', 'high'],
  };
}

export function mapFeatures(input: { features: FeatureInput[]; listenerContext?: Record<string, unknown> }) {
  if (!input || !Array.isArray(input.features) || input.features.length === 0) throw new ToolInputError('features must be a non-empty array');
  const features: Segment['features'] = {};
  const unknown: string[] = [];
  for (const f of input.features) {
    if (!f || typeof f.id !== 'string' || !featureById.has(f.id as FeatureId)) {
      unknown.push(String(f?.id));
      continue;
    }
    if (f.confidence !== undefined && !CONF.has(f.confidence)) throw new ToolInputError(`feature ${f.id}: confidence must be low, moderate or high`);
    features[f.id as FeatureId] = {
      id: f.id as FeatureId,
      present: f.present ?? true,
      confidence: f.confidence ?? 'moderate',
      status: f.confirmed ? 'confirmed' : 'auto',
      source: 'user',
      measurement: f.note ?? 'Supplied by the calling system.',
    };
  }
  if (unknown.length) throw new ToolInputError(`unknown feature id(s): ${unknown.join(', ')}. Valid ids: ${db.features.map((f) => f.id).join(', ')}`);
  const segment: Segment = { id: 'input', index: 0, start: 0, end: 0, label: 'input', features, cues: [] };
  return {
    disclaimer: DISCLAIMER,
    note: 'Features were supplied by the caller, not detected by this tool; detection accuracy is the caller\'s responsibility.',
    ...summarizeMap(mapSegment(db, segment, listenerContext(input.listenerContext))),
  };
}

function segmentsResult<E extends Record<string, unknown>>(segments: Segment[], ctx: ListenerContext, modalities: Record<string, string>, extra: E = {} as E) {
  return {
    disclaimer: DISCLAIMER,
    modalities,
    ...extra,
    segments: segments.map((s) => {
      const detected = Object.values(s.features)
        .filter((f): f is DetectedFeature => !!f)
        .map((f) => ({ id: f.id, name: featureById.get(f.id)?.name, present: f.present, detectionConfidence: f.confidence, status: f.status, source: f.source, measurement: f.measurement, values: f.values }));
      const m = summarizeMap(mapSegment(db, s, ctx));
      return {
        index: s.index,
        start: +s.start.toFixed(2),
        end: +s.end.toFixed(2),
        label: s.label,
        transcript: s.cues.map((c) => c.text).join(' ') || undefined,
        detectedFeatures: detected,
        processes: m.processes.filter((p) => p.outcome === 'applied' || p.outcome.startsWith('not applied')),
        regions: m.regions,
        associationIds: [...new Set(m.regions.flatMap((r) => r.associationIds))],
        notMappedOnPurpose: m.notMappedOnPurpose,
      };
    }),
    note: 'Look up full claims, sources and limitations with get_evidence or search_evidence using the association ids.',
  };
}

export function analyzeTranscript(input: { content: string; filename?: string; listenerContext?: Record<string, unknown> }) {
  if (!input || typeof input.content !== 'string' || !input.content.trim()) throw new ToolInputError('content must be a non-empty transcript string (SRT, WebVTT, Whisper JSON or plain text)');
  if (input.content.length > 5_000_000) throw new ToolInputError('transcript too large (max 5 MB)');
  const parsed = parseTranscript(input.filename ?? '', input.content);
  const ctx = listenerContext(input.listenerContext);
  let cues: TranscriptCue[] = parsed.cues;
  let timingNote: string | undefined;
  if (!parsed.timed) {
    // Untimed text: one segment with an estimated duration so language cues can still be reported.
    const words = (parsed.text ?? '').split(/\s+/).filter(Boolean).length;
    const seconds = Math.max(5, (words / 150) * 60);
    cues = [{ start: 0, end: seconds, text: parsed.text ?? '' }];
    timingNote = `Untimed transcript: treated as one segment with an estimated duration of ${Math.round(seconds)} s (150 words per minute). Provide SRT/VTT for per-segment results.`;
  }
  const duration = Math.max(1, ...cues.map((c) => c.end)) + 1;
  const { segments } = assemble({ duration, audio: null, video: null, cues });
  return segmentsResult(
    segments,
    ctx,
    {
      audio: 'not analysed (transcript only) - no acoustic features were measured or inferred',
      video: 'not analysed (transcript only) - no visual features were measured or inferred',
      transcript: `${parsed.format}, ${parsed.timed ? `${parsed.cues.length} timed cues` : 'untimed'}`,
    },
    { timingNote },
  );
}

/** Analyse PCM WAV audio (base64 or bytes). Other codecs need the web app (browser decoders). */
export function analyzeWavBytes(bytes: ArrayBuffer, input: { transcript?: string; transcriptFilename?: string; listenerContext?: Record<string, unknown> } = {}) {
  if (bytes.byteLength > 200 * 1024 * 1024) throw new ToolInputError('audio too large (max 200 MB); use the web app for long media');
  let info;
  try {
    info = parseWavHeader(bytes.slice(0, Math.min(bytes.byteLength, 1 << 16)));
  } catch (e) {
    throw new ToolInputError(`not a supported WAV file (${(e as Error).message}). Only PCM/float WAV can be analysed by this tool; convert other formats to WAV or use the web app, which uses the browser's decoders.`);
  }
  const end = Math.min(bytes.byteLength, info.dataBytes > 0 && info.dataBytes < 0xffffffff ? info.dataOffset + info.dataBytes : bytes.byteLength);
  const bytesPerFrame = (info.bitsPerSample / 8) * info.channels;
  const step = bytesPerFrame * info.sampleRate * 30;
  const rs = new Resampler(info.sampleRate, ANALYSIS_RATE);
  const fa = new FrameAnalyzer();
  let samples = 0;
  for (let off = info.dataOffset; off < end; off += step) {
    const mono = rs.push(pcmToMono(bytes.slice(off, Math.min(end, off + step)), info));
    fa.push(mono);
    samples += mono.length;
  }
  const duration = samples / ANALYSIS_RATE;
  if (duration < 1) throw new ToolInputError('audio is shorter than one second');
  const audio = finishAudioAnalysis(fa.out, duration);
  let cues: TranscriptCue[] = [];
  let transcriptState = 'not provided - language features were not inferred';
  if (input.transcript) {
    const parsed = parseTranscript(input.transcriptFilename ?? '', input.transcript);
    if (parsed.timed) {
      cues = parsed.cues;
      transcriptState = `${parsed.format}, ${cues.length} timed cues`;
    } else transcriptState = 'untimed text ignored for per-segment analysis (needs timestamps)';
  }
  const { segments } = assemble({ duration, audio, video: null, cues });
  return segmentsResult(segments, listenerContext(input.listenerContext), {
    audio: `analysed: ${info.channels}-channel ${info.bitsPerSample}-bit ${info.format} WAV at ${info.sampleRate} Hz, ${duration.toFixed(1)} s (heuristic detectors, validated only on synthetic signals)`,
    video: 'not analysed (audio input)',
    faces: 'not analysed (audio input)',
    transcript: transcriptState,
  });
}

export function analyzeWavBase64(input: { wavBase64: string; transcript?: string; transcriptFilename?: string; listenerContext?: Record<string, unknown> }) {
  if (!input || typeof input.wavBase64 !== 'string' || !input.wavBase64) throw new ToolInputError('wavBase64 must be a base64-encoded WAV file');
  const clean = input.wavBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const bin = typeof Buffer !== 'undefined' ? Buffer.from(clean, 'base64') : Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  const bytes = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  return analyzeWavBytes(bytes, input);
}

export function getEvidence(input: { id: string }) {
  if (!input || typeof input.id !== 'string') throw new ToolInputError('id is required (association id like "a_voice_areas", source id like "pernet2015", region id like "superior_temporal", or process id)');
  const id = input.id.trim();
  const a = db.associations.find((x) => x.id === id);
  if (a) return { type: 'association', disclaimer: DISCLAIMER, ...associationSummary(a) };
  const s = sourceById.get(id);
  if (s) return { type: 'source', ...s, usedBy: db.associations.filter((x) => x.citations.some((c) => c.source === id)).map((x) => ({ id: x.id, role: x.citations.find((c) => c.source === id)!.role })) };
  const p = processById.get(id);
  if (p) {
    const unsupported = db.unsupported.filter((u) => u.appliesTo.processes?.includes(id));
    return {
      type: 'process',
      ...p,
      rulesFromFeatures: db.rules.filter((r) => r.process === id).map((r) => ({ feature: r.feature, applicability: r.applicability, rationale: r.rationale })),
      associations: db.associations.filter((x) => x.process === id).map(associationSummary),
      insufficientEvidence: unsupported.map((u) => ({ topic: u.topic, reason: u.reason })),
    };
  }
  return getRegion({ query: id });
}

export function getRegion(input: { query: string }) {
  if (!input || typeof input.query !== 'string' || !input.query.trim()) throw new ToolInputError('query is required (region id, mesh id like "L_amygdala", or part of a name)');
  const q = input.query.trim().toLowerCase();
  const mesh = meshIndex.get(input.query.trim());
  const matches = mesh
    ? [mesh.kind === 'region' ? regionById.get(mesh.id) : undefined].filter(Boolean)
    : db.regions.filter((r) => r.id === q || r.name.toLowerCase().includes(q));
  const networks = mesh?.kind === 'network' ? [networkById.get(mesh.id)!] : db.networks.filter((n) => n.id === q || n.name.toLowerCase().includes(q));
  if (!matches.length && !networks.length) throw new ToolInputError(`no region or network matches "${input.query}". Use list_vocabulary to see ids.`);
  const forTarget = (kind: 'region' | 'network', id: string) =>
    db.associations.filter((a) => a.targets.some((t) => t.kind === kind && t.id === id)).map((a) => ({ ...associationSummary(a), targetDetail: a.targets.filter((t) => t.id === id) }));
  return {
    type: 'region',
    disclaimer: DISCLAIMER,
    regions: matches.map((r) => ({
      id: r!.id,
      name: r!.name,
      lobe: r!.lobe,
      kind: r!.kind,
      summary: r!.summary,
      orientation: r!.orientation,
      multifunction: r!.multifunction,
      associations: forTarget('region', r!.id),
    })),
    networks: networks.map((n) => ({ id: n.id, name: n.name, summary: n.summary, orientation: n.orientation, associations: forTarget('network', n.id) })),
    note: 'Regions are multifunctional and work in networks; an association here is a research finding about a process, not evidence that the region is active for any particular content.',
  };
}

export function searchEvidence(input: { query?: string; grade?: EvidenceGrade; limit?: number }) {
  const q = (input?.query ?? '').trim().toLowerCase();
  const grade = input?.grade;
  if (grade && !['strong', 'moderate', 'limited', 'contested'].includes(grade)) throw new ToolInputError('grade must be strong, moderate, limited or contested');
  const limit = Math.max(1, Math.min(50, input?.limit ?? 10));
  const hay = (a: Association) =>
    [a.id, a.claim, processById.get(a.process)?.name, ...a.targets.map((t) => (t.kind === 'region' ? regionById.get(t.id)?.name : networkById.get(t.id)?.name) ?? ''), ...a.citations.map((c) => sourceById.get(c.source)?.shortCite ?? '')]
      .join(' ')
      .toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const associations = db.associations.filter((a) => (!grade || a.grade === grade) && terms.every((t) => hay(a).includes(t))).slice(0, limit);
  const sources = terms.length
    ? db.sources.filter((s) => terms.every((t) => `${s.id} ${s.shortCite} ${s.title} ${s.stimuli} ${s.keyFindings.join(' ')}`.toLowerCase().includes(t))).slice(0, limit)
    : [];
  const unsupported = terms.length ? db.unsupported.filter((u) => terms.every((t) => `${u.topic} ${u.reason}`.toLowerCase().includes(t))) : [];
  return {
    disclaimer: DISCLAIMER,
    associations: associations.map(associationSummary),
    sources: sources.map((s) => ({ ...citation(s.id), keyFindings: s.keyFindings, limitations: s.limitations })),
    notMappedOnPurpose: unsupported.map((u) => ({ topic: u.topic, reason: u.reason })),
  };
}
