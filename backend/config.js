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
  localRfd4: {
    enabled: process.env.LOCAL_RFD4_ENABLED !== '0',
    wsl: process.env.LOCAL_RFD4_WSL || 'wsl.exe',
    distro: process.env.LOCAL_RFD4_DISTRO || 'Ubuntu-24.04',
    repo: process.env.LOCAL_RFD4_REPO || '/home/matwings/rfd4-local/repo',
    venv: process.env.LOCAL_RFD4_VENV || '/home/matwings/rfd4-local/.venv',
    runsDir: resolve(process.env.LOCAL_RFD4_RUNS_DIR || join(dataDir, 'local-runs')),
    defaultSpec: process.env.LOCAL_RFD4_SPEC || '/home/matwings/rfd4-local/repo/examples/antibody_design/structures/vhh/pmvk_3CH4__VHH_vobarilizumab_cdr123.cif.zst',
    defaultConfigPath: process.env.LOCAL_RFD4_CONFIG_PATH || '/home/matwings/rfd4-local/repo/examples/antibody_design',
    defaultConfigName: process.env.LOCAL_RFD4_CONFIG_NAME || 'vhh',
  },
  pollMs: Math.max(3000, Number(process.env.POLL_MS) || 15000),
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '127.0.0.1',
};

export function ensureParentDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}
