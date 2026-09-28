// Smoke test for the AI-tool packaging: MCP over stdio, the HTTP API (REST + OpenAPI),
// and MCP over Streamable HTTP, using the official MCP client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const ok = (m) => console.log(`ok ${m}`);
const parse = (r) => JSON.parse(r.content[0].text);

// ---- MCP stdio ----
{
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: ['tool-dist/mcp-stdio.mjs'] }));
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'analyze_audio_file'), 'local transport exposes file tool');
  const r = parse(await client.callTool({ name: 'map_features', arguments: { features: [{ id: 'faces_visible' }] } }));
  assert.ok(r.regions.some((x) => x.name === 'Right Fusiform gyrus'));
  assert.match(r.disclaimer, /NOT a brain scan/);
  const bad = await client.callTool({ name: 'map_features', arguments: { features: [{ id: 'dopamine' }] } });
  assert.equal(bad.isError, true);
  if (existsSync('tests/fixtures/program.wav')) {
    const w = parse(await client.callTool({ name: 'analyze_audio_file', arguments: { path: 'tests/fixtures/program.wav' } }));
    assert.ok(w.segments.length >= 4);
  }
  const res = await client.readResource({ uri: 'stimulus-map://how-to-read.txt' });
  assert.match(res.contents[0].text, /Evidence grades/);
  await client.close();
  ok(`MCP stdio (${tools.length} tools)`);
}

// ---- HTTP API ----
const port = 8700 + Math.floor(Math.random() * 200);
const srv = spawn('node', ['tool-dist/http-server.mjs', '--port', String(port)], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, STIMULUS_MAP_TOKEN: 'test-token' } });
await new Promise((r) => srv.stderr.on('data', (d) => String(d).includes('API on') && r()));
const base = `http://127.0.0.1:${port}`;
const auth = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
try {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(!spec.paths['/tools/analyze_audio_file'], 'file tool not exposed remotely');
  const unauth = await fetch(`${base}/tools/describe_tool`, { method: 'POST', body: '{}' });
  assert.equal(unauth.status, 401);
  const t = await fetch(`${base}/tools/analyze_transcript`, { method: 'POST', headers: auth, body: JSON.stringify({ content: readFileSync('tests/fixtures/program.srt', 'utf8'), filename: 'x.srt' }) });
  assert.equal(t.status, 200);
  const tj = await t.json();
  assert.ok(tj.segments.every((s) => !s.detectedFeatures.some((f) => f.source === 'audio' || f.source === 'video')), 'no audio/video inferred from transcript');
  const blocked = await fetch(`${base}/tools/analyze_audio_file`, { method: 'POST', headers: auth, body: JSON.stringify({ path: '/etc/passwd' }) });
  assert.equal(blocked.status, 404);
  const wavB64 = existsSync('tests/fixtures/music.wav') ? readFileSync('tests/fixtures/music.wav').toString('base64') : null;
  if (wavB64) {
    const w = await (await fetch(`${base}/tools/analyze_wav_audio`, { method: 'POST', headers: auth, body: JSON.stringify({ wavBase64: wavB64 }) })).json();
    assert.ok(w.segments.some((s) => s.detectedFeatures.some((f) => f.id === 'regular_beat' && f.present)));
  }
  const badJson = await fetch(`${base}/tools/map_features`, { method: 'POST', headers: auth, body: '{nope' });
  assert.equal(badJson.status, 400);
  ok('HTTP REST + OpenAPI + auth');

  const client = new Client({ name: 'smoke-http', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: 'Bearer test-token' } } }));
  const { tools } = await client.listTools();
  assert.ok(!tools.some((t) => t.name === 'analyze_audio_file'));
  const r = parse(await client.callTool({ name: 'search_evidence', arguments: { query: 'music', grade: 'contested' } }));
  assert.ok(r.associations.some((a) => a.id === 'a_music_language_overlap'));
  await client.close();
  ok(`MCP Streamable HTTP (${tools.length} tools)`);
} finally {
  srv.kill();
}
