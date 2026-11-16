import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(ROOT, 'dist');
const SERVE_ROOT = existsSync(join(DIST, 'index.html')) ? DIST : ROOT;
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, app: 'loopline', runtime: 'sim', frontend: 'react-astryx' }));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let filePath = resolve(normalize(join(SERVE_ROOT, pathname)));
    if (!filePath.startsWith(resolve(SERVE_ROOT) + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let info = await stat(filePath).catch(() => null);
    // SPA fallback: a path without an extension resolves to the built index.
    if ((!info || !info.isFile()) && !extname(pathname)) {
      filePath = join(SERVE_ROOT, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Loopline · VHH Design Studio`);
  console.log(`  React 19 + Astryx · serving ${SERVE_ROOT === DIST ? 'dist/' : 'source (build recommended)'}`);
  console.log(`  http://${HOST}:${PORT}\n`);
});
