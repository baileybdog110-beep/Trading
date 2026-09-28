#!/usr/bin/env node
/**
 * HTTP API for AI agents and connectors (e.g. Meta Muse custom connectors, GPT actions,
 * any agent that can call REST with an OpenAPI description), plus MCP over Streamable HTTP.
 *
 *   node tool-dist/http-server.mjs [--port 8787] [--host 127.0.0.1]
 *   STIMULUS_MAP_TOKEN=secret node tool-dist/http-server.mjs   # require "Authorization: Bearer secret"
 *
 * Endpoints: GET /  GET /health  GET /openapi.json  GET /tools.json
 *            POST /tools/{name}   POST /mcp (MCP Streamable HTTP, stateless)
 * Remote callers can never read server files: only content sent in the request is analysed.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DISCLAIMER, TOOL_NAME, TOOL_VERSION, ToolInputError } from './core';
import { callTool, definitionsFor } from './definitions';
import { buildMcpServer } from './mcp';
import { genericToolList, openApiDocument } from './openapi';

const MAX_BODY = 64 * 1024 * 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface HttpOptions {
  token?: string;
  publicUrl?: string;
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ToolInputError('request body too large (max 64 MB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHandler(opts: HttpOptions = {}) {
  const remoteTools = new Set(definitionsFor('remote').map((t) => t.name));
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const base = opts.publicUrl ?? `http://${req.headers.host ?? 'localhost'}`;
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, name: TOOL_NAME, version: TOOL_VERSION });
      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, {
          name: TOOL_NAME,
          version: TOOL_VERSION,
          disclaimer: DISCLAIMER,
          openapi: `${base}/openapi.json`,
          tools: `${base}/tools.json`,
          mcp: `${base}/mcp`,
          callExample: `POST ${base}/tools/map_features  {"features":[{"id":"speech_present"},{"id":"music_present"}]}`,
        });
      }
      if (req.method === 'GET' && url.pathname === '/openapi.json') return send(res, 200, openApiDocument(base));
      if (req.method === 'GET' && url.pathname === '/tools.json') return send(res, 200, genericToolList('remote'));

      const needsAuth = url.pathname.startsWith('/tools/') || url.pathname === '/mcp';
      if (needsAuth && opts.token && req.headers.authorization !== `Bearer ${opts.token}`) return send(res, 401, { error: 'missing or invalid bearer token' });

      if (url.pathname.startsWith('/tools/')) {
        if (req.method !== 'POST') return send(res, 405, { error: 'use POST with a JSON body' });
        const name = decodeURIComponent(url.pathname.slice('/tools/'.length));
        if (!remoteTools.has(name)) return send(res, 404, { error: `unknown tool "${name}"`, available: [...remoteTools] });
        const raw = await readBody(req);
        let args: Record<string, unknown> = {};
        if (raw.trim()) {
          try {
            args = JSON.parse(raw);
          } catch {
            return send(res, 400, { error: 'body must be JSON' });
          }
        }
        return send(res, 200, callTool(name, args, { allowLocalFiles: false }));
      }

      if (url.pathname === '/mcp') {
        if (req.method !== 'POST') return send(res, 405, { error: 'this MCP endpoint is stateless: use POST' });
        const raw = await readBody(req);
        let body: unknown;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          return send(res, 400, { error: 'body must be JSON-RPC' });
        }
        // Stateless mode: a fresh server + transport per request.
        const server = buildMcpServer('remote');
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      return send(res, 404, { error: 'not found', see: `${base}/` });
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof ToolInputError) return send(res, 400, { error: e.message });
      return send(res, 500, { error: `internal error: ${(e as Error).message}` });
    }
  };
}

const isMain = process.argv[1] && /http-server\.(m?js|ts)$/.test(process.argv[1]);
if (isMain) {
  const port = Number(arg('port') ?? process.env.PORT ?? 8787);
  const host = arg('host') ?? process.env.HOST ?? '127.0.0.1';
  const token = process.env.STIMULUS_MAP_TOKEN || undefined;
  const server = createServer(createHandler({ token, publicUrl: process.env.PUBLIC_URL }));
  server.listen(port, host, () => {
    process.stderr.write(`stimulus-association-map API on http://${host}:${port}  (OpenAPI: /openapi.json, MCP: /mcp${token ? ', bearer token required' : ''})\n`);
    if (host !== '127.0.0.1' && host !== 'localhost' && !token) process.stderr.write('warning: listening beyond localhost without STIMULUS_MAP_TOKEN\n');
  });
}
