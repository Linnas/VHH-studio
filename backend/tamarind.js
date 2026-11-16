import { strFromU8, unzipSync } from 'fflate';

export class TamarindError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'TamarindError';
    this.status = status;
    this.body = body;
  }
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((values) => values.some((v) => v !== ''))
    .map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])));
}

export function parseCdrSequences(text) {
  const result = {};
  for (const part of String(text || '').split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    result[key] = value;
  }
  return result;
}

export function normalizeJob(raw) {
  if (!raw) return null;
  const settings = parseJson(raw.Settings ?? raw.settings, {}) || {};
  const score = parseJson(raw.Score ?? raw.score, {}) || {};
  return {
    jobName: raw.JobName ?? raw.jobName ?? raw.name ?? '',
    status: raw.JobStatus ?? raw.status ?? 'unknown',
    type: raw.Type ?? raw.type ?? '',
    created: raw.Created ?? raw.created ?? null,
    started: raw.Started ?? raw.started ?? null,
    completed: raw.Completed ?? raw.completed ?? null,
    settings,
    score,
    task: settings.task || raw.task || null,
    numDesigns: num(settings.numDesigns),
    batch: raw.Batch ?? raw.batch ?? null,
  };
}

export function isRfd4Job(job) {
  return /^rfd4-proteina$/i.test(job?.type || '');
}

export function pickLatestDesignJob(jobs) {
  return jobs
    .filter((job) => job && /complete/i.test(job.status || ''))
    .filter((job) => isRfd4Job(job) || /rfd|proteina|nanobody|antibody/i.test(job.type || ''))
    .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))[0] || null;
}

function parseResultRows(csvText) {
  const rows = parseCsv(csvText);
  const designs = rows.map((row, index) => {
    const metrics = {};
    for (const [key, value] of Object.entries(row)) metrics[key] = value;
    return {
      designId: row.design_id || `design_${index + 1}`,
      sequence: row.sequence || '',
      cdrSequences: parseCdrSequences(row.cdr_sequences),
      pdbPath: row.output_pdb || '',
      metrics,
      passed: num(row.passed) === 1,
      ipTM: num(row['oracle_ppi.iptm_coi']),
      pLDDT: num(row['oracle_ppi.plddt_coi']),
      rmsd: num(row['refolded_backbone_rmsd.rmsd']),
      index,
    };
  });
  designs.sort((a, b) => (b.ipTM ?? -Infinity) - (a.ipTM ?? -Infinity) || (b.pLDDT ?? -Infinity) - (a.pLDDT ?? -Infinity));
  designs.forEach((design, index) => { design.rank = index + 1; });
  return designs;
}

export class TamarindClient {
  constructor({ apiKey, baseUrl = 'https://app.tamarind.bio/api' } = {}) {
    this.apiKey = apiKey || '';
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async request(path, { method = 'GET', body, timeout = 120000 } = {}) {
    if (!this.apiKey) throw new TamarindError('TAMARIND_API_KEY is not configured', 503);
    const headers = { 'x-api-key': this.apiKey, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new TamarindError(`Tamarind request failed: ${error.message}`, 0);
    }
    const text = await response.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* raw text response */ }
    if (!response.ok) {
      const message = typeof parsed === 'string' ? parsed : (parsed.error || parsed.message || JSON.stringify(parsed));
      throw new TamarindError(`Tamarind ${response.status}: ${message}`, response.status, parsed);
    }
    return parsed;
  }

  async listJobs(limit = 100) {
    const data = await this.request(`/jobs?limit=${Math.max(1, Math.min(1000, limit))}`);
    const rows = Array.isArray(data) ? data : (data.jobs || []);
    return rows.map(normalizeJob).filter(Boolean);
  }

  async getJob(jobName) {
    const data = await this.request(`/jobs?jobName=${encodeURIComponent(jobName)}&limit=1`);
    if (data && (data.JobName || data.jobName)) return normalizeJob(data);
    const rows = Array.isArray(data) ? data : (data.jobs || []);
    return normalizeJob(rows.find((row) => (row.JobName || row.jobName) === jobName) || rows[0]);
  }

  async getResultUrl(jobName) {
    const data = await this.request('/result', { method: 'POST', body: { jobName } });
    if (typeof data === 'string' && /^https?:\/\//.test(data)) return data;
    if (data && typeof data.url === 'string') return data.url;
    throw new TamarindError('Tamarind /result did not return a download URL', 502, data);
  }

  async downloadResults(jobName) {
    const url = await this.getResultUrl(jobName);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    } catch (error) {
      throw new TamarindError(`Result download failed: ${error.message}`, 0);
    }
    if (!response.ok) throw new TamarindError(`Result download HTTP ${response.status}`, response.status);
    const buffer = new Uint8Array(await response.arrayBuffer());
    try {
      return unzipSync(buffer);
    } catch (error) {
      throw new TamarindError(`Could not unzip Tamarind results: ${error.message}`, 502);
    }
  }

  async importJob(jobName) {
    const job = await this.getJob(jobName);
    if (!job) throw new TamarindError(`Job ${jobName} was not found`, 404);
    if (!/complete/i.test(job.status || '')) {
      throw new TamarindError(`Job ${jobName} is ${job.status}; results are available only after completion`, 409);
    }
    const files = await this.downloadResults(jobName);
    const decoder = new TextDecoder();
    const csvBytes = files['results.csv'];
    if (!csvBytes) throw new TamarindError('Result bundle has no results.csv', 502);
    const designs = parseResultRows(decoder.decode(csvBytes));
    for (const design of designs) {
      if (design.pdbPath && files[design.pdbPath]) {
        design.pdb = decoder.decode(files[design.pdbPath]);
      }
    }
    const best = designs[0] || null;
    const summary = {
      designCount: designs.length,
      passedCount: designs.filter((d) => d.passed).length,
      bestDesignId: best?.designId || null,
      bestIpTM: best?.ipTM ?? null,
      bestPLDDT: best?.pLDDT ?? null,
      bestRmsd: best?.rmsd ?? null,
      framework: job.settings?.nanobodyFramework || null,
      task: job.settings?.task || job.task || null,
      hotspots: job.settings?.hotspotResidues || null,
      targetChains: job.settings?.targetChains || null,
      targetPdb: job.settings?.pdbFile || null,
    };
    return { job, designs, summary };
  }

  async validate(type, settings) {
    return this.request('/validate-job', { method: 'POST', body: { type, settings } });
  }

  async submit({ jobName, type, settings }) {
    return this.request('/submit-job', { method: 'POST', body: { jobName, type, settings } });
  }
}
