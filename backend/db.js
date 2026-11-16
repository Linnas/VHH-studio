import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'tamarind',
  external_id TEXT UNIQUE,
  type TEXT,
  task TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  status_detail TEXT,
  settings TEXT,
  score TEXT,
  summary TEXT,
  source TEXT NOT NULL DEFAULT 'import',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  design_id TEXT,
  sequence TEXT,
  cdr_sequences TEXT,
  pdb TEXT,
  metrics TEXT,
  rank INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_external ON runs(external_id);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_designs_run ON designs(run_id, rank);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);
`;

const now = () => new Date().toISOString();

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function runRow(row, designCount = 0) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    jobName: row.external_id,
    externalId: row.external_id,
    type: row.type,
    task: row.task,
    status: row.status,
    statusDetail: row.status_detail,
    settings: parseJson(row.settings, {}),
    score: parseJson(row.score, {}),
    summary: parseJson(row.summary, {}),
    source: row.source,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    designCount: Number(designCount) || 0,
  };
}

function designRow(row, includePdb = false) {
  if (!row) return null;
  const design = {
    id: row.id,
    runId: row.run_id,
    designId: row.design_id,
    sequence: row.sequence,
    cdrSequences: parseJson(row.cdr_sequences, {}),
    metrics: parseJson(row.metrics, {}),
    rank: row.rank,
    createdAt: row.created_at,
  };
  if (includePdb) design.pdb = row.pdb;
  return design;
}

export class Store {
  constructor(dbPath) {
    if (dbPath !== ':memory:') {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this._touch = now();
  }

  close() {
    this.db.close();
  }

  /* --------------------------------- projects -------------------------------- */
  saveProject(id, name, data) {
    const timestamp = now();
    const payload = JSON.stringify(data);
    this.db.prepare(`
      INSERT INTO projects (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        data = excluded.data,
        updated_at = excluded.updated_at
    `).run(id, name || 'Untitled', payload, timestamp, timestamp);
    return { id, name: name || 'Untitled', updatedAt: timestamp, data };
  }

  getProject(id) {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) return null;
    return { id: row.id, name: row.name, data: parseJson(row.data, {}), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listProjects(limit = 50) {
    return this.db.prepare('SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC LIMIT ?').all(limit)
      .map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  /* ----------------------------------- runs ---------------------------------- */
  getRunByExternalId(externalId) {
    if (!externalId) return null;
    const row = this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM designs d WHERE d.run_id = r.id) AS design_count
      FROM runs r WHERE r.external_id = ?
    `).get(externalId);
    return runRow(row, row?.design_count);
  }

  getRun(id) {
    const row = this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM designs d WHERE d.run_id = r.id) AS design_count
      FROM runs r WHERE r.id = ?
    `).get(id);
    return runRow(row, row?.design_count);
  }

  listRuns(limit = 50) {
    return this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM designs d WHERE d.run_id = r.id) AS design_count
      FROM runs r ORDER BY datetime(r.created_at) DESC LIMIT ?
    `).all(limit).map((row) => runRow(row, row.design_count));
  }

  listActiveRuns() {
    return this.db.prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM designs d WHERE d.run_id = r.id) AS design_count
      FROM runs r
      WHERE r.provider = 'tamarind'
        AND lower(r.status) NOT IN ('complete', 'failed', 'stopped', 'error')
      ORDER BY datetime(r.created_at) ASC
    `).all().map((row) => runRow(row, row.design_count));
  }

  saveRun(run) {
    const existing = run.externalId ? this.getRunByExternalId(run.externalId) : (run.id ? this.getRun(run.id) : null);
    const id = existing?.id || run.id || `run_${randomUUID()}`;
    const createdAt = run.createdAt || existing?.createdAt || now();
    const updatedAt = now();
    this.db.prepare(`
      INSERT INTO runs
        (id, provider, external_id, type, task, status, status_detail, settings, score, summary, source, error, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        external_id = excluded.external_id,
        type = excluded.type,
        task = excluded.task,
        status = excluded.status,
        status_detail = excluded.status_detail,
        settings = excluded.settings,
        score = excluded.score,
        summary = excluded.summary,
        error = excluded.error,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `).run(
      id,
      run.provider || 'tamarind',
      run.externalId || null,
      run.type || null,
      run.task || null,
      run.status || 'unknown',
      run.statusDetail || null,
      JSON.stringify(run.settings || {}),
      JSON.stringify(run.score || {}),
      JSON.stringify(run.summary || {}),
      run.source || 'import',
      run.error || null,
      createdAt,
      updatedAt,
      run.completedAt || existing?.completedAt || null,
    );
    return this.getRun(id);
  }

  replaceDesigns(runId, designs) {
    const createdAt = now();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM designs WHERE run_id = ?').run(runId);
      const insert = this.db.prepare(`
        INSERT INTO designs (id, run_id, design_id, sequence, cdr_sequences, pdb, metrics, rank, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      designs.forEach((design, index) => {
        insert.run(
          `dsg_${randomUUID()}`,
          runId,
          design.designId || `design_${index + 1}`,
          design.sequence || '',
          JSON.stringify(design.cdrSequences || {}),
          design.pdb || null,
          JSON.stringify(design.metrics || {}),
          design.rank ?? index + 1,
          createdAt,
        );
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listDesigns(runId);
  }

  listDesigns(runId, includePdb = false) {
    const rows = this.db.prepare('SELECT * FROM designs WHERE run_id = ? ORDER BY rank ASC, design_id ASC').all(runId);
    return rows.map((row) => designRow(row, includePdb));
  }

  getDesign(id) {
    return designRow(this.db.prepare('SELECT * FROM designs WHERE id = ?').get(id), true);
  }

  getRunDetail(id) {
    const run = this.getRun(id);
    if (!run) return null;
    return {
      ...run,
      designs: this.listDesigns(id),
      events: this.listEvents(id),
    };
  }

  /* ---------------------------------- events --------------------------------- */
  addEvent(runId, message, level = 'info') {
    this.db.prepare('INSERT INTO events (run_id, level, message, created_at) VALUES (?, ?, ?, ?)')
      .run(runId || null, level, message, now());
  }

  listEvents(runId, limit = 100) {
    return this.db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY id DESC LIMIT ?').all(runId, limit)
      .map((row) => ({ id: row.id, level: row.level, message: row.message, createdAt: row.created_at }))
      .reverse();
  }

  stats() {
    const projects = this.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
    const runs = this.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
    const designs = this.db.prepare('SELECT COUNT(*) AS n FROM designs').get().n;
    return { projects, runs, designs };
  }
}
