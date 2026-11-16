import { randomUUID } from 'node:crypto';
import { pickLatestDesignJob } from './tamarind.js';

const ACTIVE_STATUSES = /^(in queue|queued|running|pending|submitted|starting)$/i;

export function sanitizeRfd4Settings(input = {}) {
  const copy = { ...input };
  delete copy.type;
  delete copy.submit_method;
  delete copy._pdbFile_residueCount;
  delete copy.output_pdb;
  return copy;
}

export function defaultRfd4Settings(job = null, overrides = {}) {
  const fromJob = job?.settings || {};
  const base = {
    task: 'nanobody-design',
    modelCheckpoint: fromJob.modelCheckpoint || 'antibody-2026-10-30',
    pdbFile: fromJob.pdbFile || '',
    targetChains: fromJob.targetChains || ['A'],
    hotspotResidues: fromJob.hotspotResidues || { A: '62,63' },
    nanobodyFramework: fromJob.nanobodyFramework || 'vobarilizumab',
    numDesigns: 8,
    samplingEffort: 'thinking_high',
    samplingSteps: 60,
    frameworkAtoms: 'backbone',
    repackTargetInterface: true,
    hotspotAtoms: 'single-atom',
    preOracleFilters: true,
    refoldDesigns: true,
    seed: fromJob.seed || 20261112,
  };
  return sanitizeRfd4Settings({
    ...base,
    ...overrides,
    numDesigns: overrides.numDesigns ?? base.numDesigns,
  });
}

export class RunManager {
  constructor({ store, tamarind, pollMs = 15000, logger = console }) {
    this.store = store;
    this.tamarind = tamarind;
    this.pollMs = pollMs;
    this.logger = logger;
    this.timer = null;
    this.syncing = new Set();
    this.latestCache = null;
    this.latestCacheAt = 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => this.logger.warn?.('Tamarind poll failed:', error.message)), this.pollMs);
    this.timer.unref?.();
    this.tick().catch((error) => this.logger.warn?.('Tamarind initial poll failed:', error.message));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (!this.tamarind.configured) return;
    const active = this.store.listActiveRuns();
    for (const run of active) {
      await this.syncRun(run.id).catch((error) => this.logger.warn?.(`Sync ${run.jobName} failed:`, error.message));
    }
  }

  async listTamarindJobs(limit = 100, force = false) {
    if (!force && this.latestCache && Date.now() - this.latestCacheAt < 30000) return this.latestCache;
    const jobs = await this.tamarind.listJobs(limit);
    const latest = pickLatestDesignJob(jobs);
    this.latestCache = { jobs, latest, fetchedAt: new Date().toISOString() };
    this.latestCacheAt = Date.now();
    return this.latestCache;
  }

  async latestDesignJob() {
    if (this.latestCache && Date.now() - this.latestCacheAt < 30000) return this.latestCache;
    return this.listTamarindJobs(100);
  }

  async importJob(jobName, source = 'import') {
    const imported = await this.tamarind.importJob(jobName);
    const { job, designs, summary } = imported;
    const run = this.store.saveRun({
      externalId: job.jobName,
      provider: 'tamarind',
      type: job.type,
      task: job.task,
      status: job.status,
      settings: job.settings,
      score: job.score,
      summary,
      source,
      createdAt: job.created ? `${job.created.replace(' ', 'T')}Z` : undefined,
      completedAt: job.completed ? `${job.completed.replace(' ', 'T')}Z` : undefined,
    });
    this.store.replaceDesigns(run.id, designs.map((d) => ({
      designId: d.designId,
      sequence: d.sequence,
      cdrSequences: d.cdrSequences,
      pdb: d.pdb,
      metrics: d.metrics,
      rank: d.rank,
    })));
    this.store.addEvent(run.id, `Imported ${designs.length} designs from Tamarind job ${job.jobName}`, 'success');
    return this.store.getRunDetail(run.id);
  }

  async importLatest() {
    const { jobs, latest } = await this.latestDesignJob();
    if (!latest) {
      return { imported: false, reason: 'No completed RFD4 design jobs found', jobs };
    }
    const existing = this.store.getRunByExternalId(latest.jobName);
    if (existing && existing.status === 'Complete' && existing.designCount > 0) {
      return { imported: false, alreadyImported: true, job: latest, run: this.store.getRunDetail(existing.id) };
    }
    const run = await this.importJob(latest.jobName, 'import-latest');
    return { imported: true, job: latest, run };
  }

  async syncRun(runId) {
    if (this.syncing.has(runId)) return this.store.getRunDetail(runId);
    this.syncing.add(runId);
    try {
      const run = this.store.getRun(runId);
      if (!run) throw new Error(`Run ${runId} not found`);
      if (!ACTIVE_STATUSES.test(run.status) && run.status !== 'unknown') return this.store.getRunDetail(runId);
      const job = await this.tamarind.getJob(run.jobName);
      if (!job) throw new Error(`Tamarind job ${run.jobName} not found`);
      if (/complete/i.test(job.status)) {
        return await this.importJob(job.jobName, run.source);
      }
      if (/stopped|failed|error|cancelled/i.test(job.status)) {
        this.store.addEvent(run.id, `Tamarind job ${job.status}`, 'error');
      }
      const updated = this.store.saveRun({
        ...run,
        status: job.status,
        statusDetail: job.status,
        score: job.score,
        settings: job.settings,
        error: /failed|error/i.test(job.status) ? `Tamarind reported ${job.status}` : run.error,
      });
      return this.store.getRunDetail(updated.id);
    } finally {
      this.syncing.delete(runId);
    }
  }

  async validateRfd4(settings) {
    const normalized = await this.tamarind.validate('rfd4-proteina', sanitizeRfd4Settings(settings));
    return normalized;
  }

  async submitRfd4(settings, requestedName) {
    if (!this.tamarind.configured) throw new Error('TAMARIND_API_KEY is not configured');
    const safe = sanitizeRfd4Settings(settings);
    const validation = await this.tamarind.validate('rfd4-proteina', safe);
    if (!validation.valid) {
      return { submitted: false, validation };
    }
    const jobName = requestedName || `loopline-rfd4-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    const normalized = validation.normalized || safe;
    const response = await this.tamarind.submit({ jobName, type: 'rfd4-proteina', settings: normalized });
    const run = this.store.saveRun({
      externalId: jobName,
      provider: 'tamarind',
      type: 'rfd4-proteina',
      task: normalized.task || 'nanobody-design',
      status: 'In Queue',
      statusDetail: typeof response === 'string' ? response : 'Submitted',
      settings: normalized,
      source: 'submit',
    });
    this.store.addEvent(run.id, `Submitted RFD4 job ${jobName} to Tamarind`, 'success');
    this.start();
    return { submitted: true, jobName, run: this.store.getRunDetail(run.id), validation };
  }

  async getRunDetail(id) {
    return this.store.getRunDetail(id);
  }
}
