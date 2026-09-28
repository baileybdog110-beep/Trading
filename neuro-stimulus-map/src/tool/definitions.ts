/**
 * Tool definitions (JSON Schema) shared by the MCP server, the HTTP API/OpenAPI document,
 * the CLI and tool/tools.json. Descriptions are written for other AI models: they state
 * what each tool can and cannot conclude.
 */
import { readFileSync, statSync } from 'node:fs';
import {
  DISCLAIMER,
  ToolInputError,
  analyzeTranscript,
  analyzeWavBase64,
  analyzeWavBytes,
  describeTool,
  getEvidence,
  getRegion,
  listVocabulary,
  mapFeatures,
  searchEvidence,
} from './core';
import { db } from '../evidence/db';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Reads local files: only exposed by local transports (MCP stdio, CLI), never over HTTP. */
  localOnly?: boolean;
}

const listenerContextSchema = {
  type: 'object',
  description:
    'Optional facts about the listener. Some findings only apply if the listener understands the language, enjoys the music, or finds the humor funny. "unknown" keeps those associations but marks them as dependent on the listener; "no" removes them.',
  properties: {
    understands_language: { type: 'string', enum: ['unknown', 'yes', 'no'] },
    enjoys_music: { type: 'string', enum: ['unknown', 'yes', 'no'] },
    finds_funny: { type: 'string', enum: ['unknown', 'yes', 'no'] },
  },
  additionalProperties: false,
};

const featureIds = db.features.map((f) => f.id);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'describe_tool',
    title: 'Describe the stimulus association map',
    description:
      'Returns what this tool is, its disclaimer, evidence grading rubric, citation-verification status and database counts. Call this first to understand how to interpret results. ' + DISCLAIMER,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_vocabulary',
    title: 'List feature, process, region and network ids',
    description: 'Lists every media feature id that map_features accepts (with how it is detected and its limits), candidate cognitive processes, atlas regions and networks.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'map_features',
    title: 'Map media features to research associations',
    description:
      'Given features that are present in some media (e.g. speech_present, regular_beat, faces_visible), returns the candidate cognitive processes, the curated research associations (claim, evidence grade, cited sources with findings, limitations) and the brain regions/networks those associations name. Also returns explicit "insufficient evidence" records for inputs that research does not support mapping (e.g. emotional_theme). Interpretive features (humor, suspense, surprise, emotional_theme, situation_change, places_layout) only count when confirmed: true. This does NOT describe any person\'s brain activity.',
    inputSchema: {
      type: 'object',
      properties: {
        features: {
          type: 'array',
          minItems: 1,
          description: 'Features observed in the media.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: featureIds, description: 'Feature id (see list_vocabulary).' },
              present: { type: 'boolean', default: true },
              confidence: { type: 'string', enum: ['low', 'moderate', 'high'], default: 'moderate', description: 'How sure the caller is that the feature is present (detection confidence, not evidence strength).' },
              confirmed: { type: 'boolean', default: false, description: 'Set true when a person has confirmed the feature; required for interpretive features.' },
              note: { type: 'string', description: 'Optional description of how the feature was observed.' },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
        listenerContext: listenerContextSchema,
      },
      required: ['features'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_transcript',
    title: 'Analyse a transcript',
    description:
      'Segments a transcript (SRT, WebVTT, Whisper-style JSON with timestamps, or plain text) and detects transparent lexical features per segment (spoken words and speaking rate, narrative cues, mental-state language, laughter annotations, emotion words), then maps them to research associations. Audio and video are reported as not analysed; nothing acoustic or visual is inferred.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The transcript text.' },
        filename: { type: 'string', description: 'Optional file name (helps detect the format, e.g. talk.srt).' },
        listenerContext: listenerContextSchema,
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_wav_audio',
    title: 'Analyse WAV audio',
    description:
      'Analyses a PCM WAV recording (base64) with the app\'s transparent audio heuristics: sound, speech-like and music-like audio, regular beat and tempo, loudness changes and abrupt onsets, segmented over time, optionally with a timed transcript. Returns per-segment detected features (with detection confidence) and research associations. Detectors were validated only on synthetic signals. Other formats (MP3, MP4, MOV) need the web app or conversion to WAV.',
    inputSchema: {
      type: 'object',
      properties: {
        wavBase64: { type: 'string', description: 'Base64-encoded WAV file (data: URL prefix allowed).' },
        transcript: { type: 'string', description: 'Optional timed transcript (SRT/VTT/JSON) for the same audio.' },
        transcriptFilename: { type: 'string' },
        listenerContext: listenerContextSchema,
      },
      required: ['wavBase64'],
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_audio_file',
    title: 'Analyse a local WAV file',
    description: 'Same as analyze_wav_audio but reads a WAV file from a local path (local MCP/CLI use only), optionally with a local transcript file.',
    localOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to a .wav file.' },
        transcriptPath: { type: 'string', description: 'Optional path to an .srt/.vtt/.json transcript.' },
        listenerContext: listenerContextSchema,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_evidence',
    title: 'Get an evidence record',
    description:
      'Returns the full record for an association id (claim, grade and rationale, targets, every cited source with its actual finding, limitations), a source id (study design, sample, stimuli, findings, limitations, verification level), a process id, or a region/network.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'get_region',
    title: 'Look up a brain region or network',
    description:
      'Finds a region or network by id, mesh id (e.g. L_amygdala) or name fragment and returns plain-language orientation, a reminder that regions are multifunctional, and every curated association that names it.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'search_evidence',
    title: 'Search the evidence database',
    description: 'Full-text search over associations (claims, processes, regions, cited studies), sources and deliberate non-mappings. Optionally filter associations by evidence grade.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words that must all appear, e.g. "music reward" or "faces fusiform".' },
        grade: { type: 'string', enum: ['strong', 'moderate', 'limited', 'contested'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      additionalProperties: false,
    },
  },
];

const MAX_LOCAL_FILE = 200 * 1024 * 1024;

function readLocal(path: string, max: number): Buffer {
  const st = statSync(path);
  if (!st.isFile()) throw new ToolInputError(`${path} is not a regular file`);
  if (st.size > max) throw new ToolInputError(`${path} is too large`);
  return readFileSync(path);
}

type Args = Record<string, unknown>;

/** Dispatch a tool call. `allowLocalFiles` must only be true for local transports. */
export function callTool(name: string, args: Args = {}, opts: { allowLocalFiles?: boolean } = {}): unknown {
  switch (name) {
    case 'describe_tool':
      return describeTool();
    case 'list_vocabulary':
      return listVocabulary();
    case 'map_features':
      return mapFeatures(args as Parameters<typeof mapFeatures>[0]);
    case 'analyze_transcript':
      return analyzeTranscript(args as Parameters<typeof analyzeTranscript>[0]);
    case 'analyze_wav_audio':
      return analyzeWavBase64(args as Parameters<typeof analyzeWavBase64>[0]);
    case 'analyze_audio_file': {
      if (!opts.allowLocalFiles) throw new ToolInputError('analyze_audio_file is only available locally (MCP stdio or CLI). Use analyze_wav_audio with base64 content.');
      if (typeof args.path !== 'string') throw new ToolInputError('path is required');
      const buf = readLocal(args.path, MAX_LOCAL_FILE);
      const transcript = typeof args.transcriptPath === 'string' ? readLocal(args.transcriptPath, 5 * 1024 * 1024).toString('utf8') : undefined;
      return analyzeWavBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, {
        transcript,
        transcriptFilename: typeof args.transcriptPath === 'string' ? args.transcriptPath : undefined,
        listenerContext: args.listenerContext as Record<string, unknown> | undefined,
      });
    }
    case 'get_evidence':
      return getEvidence(args as { id: string });
    case 'get_region':
      return getRegion(args as { query: string });
    case 'search_evidence':
      return searchEvidence(args as Parameters<typeof searchEvidence>[0]);
    default:
      throw new ToolInputError(`unknown tool "${name}". Available: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`);
  }
}

export function definitionsFor(transport: 'local' | 'remote'): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((t) => transport === 'local' || !t.localOnly);
}
