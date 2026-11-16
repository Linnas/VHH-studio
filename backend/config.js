import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(join(ROOT, '.env'));

const dataDir = resolve(process.env.LOOPLINE_DATA_DIR || join(ROOT, 'data'));
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

export const config = {
  root: ROOT,
  dataDir,
  dbPath: resolve(process.env.LOOPLINE_DB_PATH || join(dataDir, 'loopline.db')),
  tamarind: {
    apiKey: process.env.TAMARIND_API_KEY || '',
    baseUrl: (process.env.TAMARIND_BASE_URL || 'https://app.tamarind.bio/api').replace(/\/+$/, ''),
  },
  pollMs: Math.max(3000, Number(process.env.POLL_MS) || 15000),
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '127.0.0.1',
};

export function ensureParentDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}
