import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { config } from './backend/config.js';
import { Store } from './backend/db.js';
import { TamarindClient } from './backend/tamarind.js';
import { LocalRFD4 } from './backend/local-rfd4.js';
import { RunManager } from './backend/runner.js';
import { createApi } from './backend/api.js';

const ROOT = config.root;
const DIST = join(ROOT, 'dist');
const SERVE_ROOT = existsSync(join(DIST, 'index.html')) ? DIST : ROOT;

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
  '.pdb': 'chemical/x-pdb; charset=utf-8',
  '.cif': 'chemical/x-cif; charset=utf-8',
};

const store = new Store(config.dbPath);
const tamarind = new TamarindClient(config.tamarind);
const localRfd4 = new LocalRFD4({ config: config.localRfd4, store });
const manager = new RunManager({ store, tamarind, localRfd4, pollMs: config.pollMs });
const handleApi = createApi({ store, tamarind, localRfd4, manager, version: '0.3.0' });
manager.start();
localRfd4.recoverInterrupted().catch((error) => console.warn('Local RFD4 recovery failed:', error.message));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  try {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let filePath = resolve(normalize(join(SERVE_ROOT, pathname)));
    if (!filePath.startsWith(resolve(SERVE_ROOT) + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let info = await stat(filePath).catch(() => null);
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

server.listen(config.port, config.host, () => {
  console.log(`\n  Loopline · VHH Design Studio`);
  console.log(`  React 19 + Astryx · serving ${SERVE_ROOT === DIST ? 'dist/' : 'source (build recommended)'}`);
  console.log(`  SQLite · ${config.dbPath}`);
  console.log(`  Tamarind · ${tamarind.configured ? 'configured (RFD4 executor ready)' : 'not configured'}`);
  console.log(`  Local RFD4 · ${localRfd4.configured ? `enabled (${config.localRfd4.distro})` : 'disabled'}`);
  console.log(`  http://${config.host}:${config.port}\n`);
});

function shutdown() {
  manager.stop();
  store.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
