import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { db } from '../evidence/db';
import { DISCLAIMER, TOOL_NAME, TOOL_VERSION, ToolInputError } from './core';
import { callTool, definitionsFor } from './definitions';

const RESOURCES = [
  {
    uri: 'stimulus-map://evidence-database.json',
    name: 'Evidence database',
    description: 'All curated sources, associations, rules and deliberate non-mappings (JSON).',
    mimeType: 'application/json',
  },
  {
    uri: 'stimulus-map://how-to-read.txt',
    name: 'How to interpret results',
    description: 'Disclaimer, grading rubric and verification status.',
    mimeType: 'text/plain',
  },
];

/**
 * Build an MCP server exposing the stimulus association map tools.
 * `transport: 'local'` (stdio) additionally exposes tools that read local files.
 */
export function buildMcpServer(transport: 'local' | 'remote'): Server {
  const server = new Server(
    { name: TOOL_NAME, version: TOOL_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        `${DISCLAIMER} Typical use: call describe_tool once, then map_features with the features you observed in the media (or analyze_transcript / analyze_wav_audio), then get_evidence for any association you cite. ` +
        'When reporting results to people, keep evidence grade, detection confidence and applicability separate, name the sources, and never describe the output as a brain scan or as what a person\'s brain is doing.',
    },
  );
  const tools = definitionsFor(transport);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as { type: 'object' } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = tools.find((t) => t.name === req.params.name);
    if (!def) return { content: [{ type: 'text', text: `Error: unknown tool ${req.params.name}` }], isError: true };
    try {
      const result = callTool(def.name, (req.params.arguments ?? {}) as Record<string, unknown>, { allowLocalFiles: transport === 'local' });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const msg = e instanceof ToolInputError ? e.message : `internal error: ${(e as Error).message}`;
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri === RESOURCES[0].uri) {
      return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: JSON.stringify(db, null, 1) }] };
    }
    if (req.params.uri === RESOURCES[1].uri) {
      const rubric = Object.entries(db.meta.gradingRubric)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      const appl = Object.entries(db.meta.applicabilityRubric)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      return {
        contents: [
          {
            uri: req.params.uri,
            mimeType: 'text/plain',
            text: `${DISCLAIMER}\n\nEvidence grades:\n${rubric}\n\nApplicability:\n${appl}\n\nVerification: ${db.meta.verificationStatement}`,
          },
        ],
      };
    }
    throw new Error(`unknown resource ${req.params.uri}`);
  });
  return server;
}
