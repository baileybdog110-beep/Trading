import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ToolInputError, analyzeTranscript, getEvidence, getRegion, mapFeatures, searchEvidence } from '../src/tool/core';
import { TOOL_DEFINITIONS, callTool } from '../src/tool/definitions';
import { genericToolList, openApiDocument } from '../src/tool/openapi';

describe('AI tool core', () => {
  it('keeps the published tool descriptions in sync with the code (run npm run build:tool)', () => {
    expect(JSON.parse(readFileSync('tool/tools.json', 'utf8'))).toEqual(genericToolList('remote'));
    expect(JSON.parse(readFileSync('tool/tools.local.json', 'utf8'))).toEqual(genericToolList('local'));
    expect(JSON.parse(readFileSync('tool/openapi.json', 'utf8'))).toEqual(openApiDocument());
  });

  it('never exposes local-file tools remotely', () => {
    expect(genericToolList('remote').map((t) => t.name)).not.toContain('analyze_audio_file');
    expect(Object.keys(openApiDocument().paths)).not.toContain('/tools/analyze_audio_file');
    expect(() => callTool('analyze_audio_file', { path: '/etc/passwd' })).toThrow(ToolInputError);
  });

  it('maps features only through evidence records and always carries the disclaimer', () => {
    const r = mapFeatures({ features: [{ id: 'speech_present' }, { id: 'faces_visible' }] });
    expect(r.disclaimer).toMatch(/NOT a brain scan/);
    expect(r.regions.length).toBeGreaterThan(0);
    const ids = new Set(r.associations.map((a) => a.id));
    for (const reg of r.regions) for (const a of reg.associationIds) expect(ids.has(a)).toBe(true);
    for (const a of r.associations) expect(a.sources.some((s) => s.role === 'supports')).toBe(true);
  });

  it('requires confirmation for interpretations and returns insufficient evidence for emotion themes', () => {
    expect(mapFeatures({ features: [{ id: 'humor' }] }).regions).toEqual([]);
    expect(mapFeatures({ features: [{ id: 'humor', confirmed: true }] }).regions.length).toBeGreaterThan(0);
    const e = mapFeatures({ features: [{ id: 'emotional_theme', confirmed: true }] });
    expect(e.regions).toEqual([]);
    expect(e.processes[0].insufficientEvidence.length).toBeGreaterThan(0);
  });

  it('honours listener context', () => {
    const yes = mapFeatures({ features: [{ id: 'music_present' }], listenerContext: { enjoys_music: 'yes' } });
    const no = mapFeatures({ features: [{ id: 'music_present' }], listenerContext: { enjoys_music: 'no' } });
    expect(yes.regions.some((r) => r.name.includes('accumbens'))).toBe(true);
    expect(no.regions.some((r) => r.name.includes('accumbens'))).toBe(false);
    expect(() => mapFeatures({ features: [{ id: 'music_present' }], listenerContext: { enjoys_music: 'maybe' } })).toThrow(ToolInputError);
  });

  it('rejects unknown features with a helpful message', () => {
    expect(() => mapFeatures({ features: [{ id: 'dopamine_release' }] })).toThrow(/unknown feature id/);
    expect(() => mapFeatures({ features: [] })).toThrow(ToolInputError);
  });

  it('analyses untimed transcripts without inventing audio or video', () => {
    const r = analyzeTranscript({ content: 'She thought he knew. Then they wondered what she wanted, and later he remembered the storm and the town. '.repeat(4) });
    expect(r.timingNote).toMatch(/Untimed/);
    expect(r.modalities.audio).toMatch(/not analysed/);
    for (const s of r.segments) for (const f of s.detectedFeatures) expect(f.source).toBe('transcript');
  });

  it('looks up regions, evidence records and searches', () => {
    expect(getRegion({ query: 'L_amygdala' }).regions[0].id).toBe('amygdala');
    expect(getRegion({ query: 'fusiform' }).regions[0].associations.length).toBeGreaterThan(0);
    expect(getEvidence({ id: 'a_voice_areas' })).toMatchObject({ type: 'association', evidenceGrade: 'strong' });
    expect(getEvidence({ id: 'pernet2015' })).toMatchObject({ type: 'source', n: '218' });
    expect(getEvidence({ id: 'emotion_category' })).toMatchObject({ type: 'process', associations: [] });
    expect(searchEvidence({ query: 'humor', grade: 'contested' }).associations.map((a) => a.id)).toEqual(['a_humor_accumbens']);
  });

  it('declares valid JSON-schema inputs for every tool', () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.description.length, t.name).toBeGreaterThan(40);
    }
  });
});
