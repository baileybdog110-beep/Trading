// Builds the copy of the app published to a hosted, sandboxed viewer (claude.ai artifact).
// The viewer wraps the page in its own <html>/<head>/<body>, so this turns the Vite build's
// index.html into body content and lists the files to publish next to it.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const OUT = 'dist-hosted';
execSync(`npx vite build --mode hosted --outDir ${OUT} --emptyOutDir`, { stdio: 'inherit' });

const html = readFileSync(join(OUT, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const keep = head
  .split('\n')
  .map((l) => l.trim())
  // The viewer supplies charset, viewport and tab icon; home-screen metadata does not apply inside it.
  .filter((l) => l && !/charset|name="viewport"|theme-color|apple-mobile|mobile-web-app|rel="manifest"|apple-touch-icon|rel="icon"/.test(l));
// <title> first so the viewer finds it.
keep.sort((a, b) => (b.startsWith('<title>') ? 1 : 0) - (a.startsWith('<title>') ? 1 : 0));
writeFileSync(join(OUT, 'page.html'), `${keep.join('\n')}\n${body.trim()}\n`);

// Files to publish next to the page (skip docs and the unused PWA files).
const files = {};
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(OUT, p);
      if (/^(index|page)\.html$|\.md$|^manifest\.webmanifest$|^icons\//.test(rel)) continue;
      if (/\.(glb|bin)$/.test(rel)) {
        // Binary types are not served by the viewer: publish base64 text (read by fetchBinary).
        writeFileSync(`${p}.b64.txt`, readFileSync(p).toString('base64'));
        files[`${rel}.b64.txt`] = `${p}.b64.txt`;
      } else if (!rel.endsWith('.b64.txt')) files[rel] = p;
    }
  }
};
walk(OUT);
writeFileSync(join(OUT, 'files.json'), JSON.stringify(files, null, 2));
console.log(`wrote ${OUT}/page.html and ${OUT}/files.json (${Object.keys(files).length} files)`);
