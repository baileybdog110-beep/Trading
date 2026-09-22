// Minimal zero-dependency server: serves the app and relays Tradovate API calls
// so the browser doesn't hit CORS limits. Nothing is logged or stored. Credentials
// and tokens pass straight through to Tradovate.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = +process.env.PORT || 3000;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const HOSTS = {
  live: 'https://live.tradovateapi.com/v1',
  demo: 'https://demo.tradovateapi.com/v1',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.ico': 'image/x-icon',
};

async function proxy(req, res, env, path) {
  const target = HOSTS[env];
  if (!target) return send(res, 400, { errorText: 'Unknown environment' });
  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const headers = { Accept: 'application/json' };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (body.length) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(target + path, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
    });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(text);
  } catch (e) {
    send(res, 502, { errorText: `Could not reach Tradovate: ${e.message}` });
  }
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Forbidden' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/tv\/(live|demo)(\/.*)$/);
  if (m) return proxy(req, res, m[1], m[2] + url.search);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  return serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`PropPath running at http://localhost:${PORT}`);
});
