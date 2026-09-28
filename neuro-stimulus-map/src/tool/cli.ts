#!/usr/bin/env node
/**
 * Command-line access for agents that can run shell commands.
 *
 *   node tool-dist/cli.mjs tools                          # list tools (JSON)
 *   node tool-dist/cli.mjs features speech_present,music_present [--confirmed humor]
 *   node tool-dist/cli.mjs transcript talk.srt
 *   node tool-dist/cli.mjs wav clip.wav [--transcript clip.srt]
 *   node tool-dist/cli.mjs call <tool> '<json args>'      # any tool
 *   node tool-dist/cli.mjs openapi                        # OpenAPI document
 * Output is JSON on stdout; errors go to stderr with exit code 1 (bad input) or 2 (internal).
 */
import { readFileSync } from 'node:fs';
import { ToolInputError } from './core';
import { callTool } from './definitions';
import { genericToolList, openApiDocument } from './openapi';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function run(): unknown {
  const [cmd, a1, a2] = process.argv.slice(2);
  switch (cmd) {
    case 'tools':
      return genericToolList('local');
    case 'openapi':
      return openApiDocument();
    case 'features': {
      if (!a1) throw new ToolInputError('usage: features id1,id2 [--confirmed id3,id4]');
      const confirmed = (flag('confirmed') ?? '').split(',').filter(Boolean);
      const ids = [...new Set([...a1.split(',').filter(Boolean), ...confirmed])];
      return callTool('map_features', { features: ids.map((id) => ({ id, confirmed: confirmed.includes(id) || undefined })) }, { allowLocalFiles: true });
    }
    case 'transcript':
      if (!a1) throw new ToolInputError('usage: transcript <file>');
      return callTool('analyze_transcript', { content: readFileSync(a1, 'utf8'), filename: a1 }, { allowLocalFiles: true });
    case 'wav':
      if (!a1) throw new ToolInputError('usage: wav <file.wav> [--transcript file.srt]');
      return callTool('analyze_audio_file', { path: a1, transcriptPath: flag('transcript') }, { allowLocalFiles: true });
    case 'call':
      if (!a1) throw new ToolInputError("usage: call <tool> '<json>'");
      return callTool(a1, a2 ? JSON.parse(a2) : {}, { allowLocalFiles: true });
    default:
      throw new ToolInputError('commands: tools | features | transcript | wav | call | openapi (see the header of src/tool/cli.ts)');
  }
}

try {
  process.stdout.write(JSON.stringify(run(), null, 2) + '\n');
} catch (e) {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exit(e instanceof ToolInputError || e instanceof SyntaxError ? 1 : 2);
}
