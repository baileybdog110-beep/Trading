import { DISCLAIMER, TOOL_VERSION } from './core';
import { definitionsFor } from './definitions';

/** OpenAPI 3.1 description of the HTTP API (one POST operation per remote tool). */
export function openApiDocument(serverUrl?: string) {
  const paths: Record<string, unknown> = {};
  for (const t of definitionsFor('remote')) {
    paths[`/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        requestBody: { required: true, content: { 'application/json': { schema: t.inputSchema } } },
        responses: {
          '200': { description: 'Tool result (JSON). Always includes or implies the disclaimer: not a brain scan.', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Missing or wrong bearer token (only when the server was started with a token)' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Stimulus Association Map API',
      version: TOOL_VERSION,
      description: `${DISCLAIMER}\n\nThe same tools are available over MCP (Streamable HTTP) at POST /mcp.`,
      license: { name: 'See repository (atlas data CC BY 4.0 / MIT; evidence records cite their sources)' },
    },
    servers: serverUrl ? [{ url: serverUrl }] : [{ url: 'http://127.0.0.1:8787' }],
    paths,
    components: {
      schemas: { Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    security: [{ bearer: [] }, {}],
  };
}

/** Generic tool list (Anthropic-style name/description/input_schema; trivially mappable to other function-calling formats). */
export function genericToolList(transport: 'local' | 'remote' = 'remote') {
  return definitionsFor(transport).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}
