import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Badge } from '@astryxdesign/core/Badge';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Switch } from '@astryxdesign/core/Switch';
import { api, formatJobDate, pdbUrl } from '../lib/backend';
import type { BackendRun, TamarindJob } from '../lib/backend';
import { Glyph } from '../lib/icons';

type JobsResponse = {
  configured: boolean;
  jobs: TamarindJob[];
  latestDesignJob: TamarindJob | null;
  imported: Array<{ jobName: string; runId: string; status: string; designCount: number }>;
  defaults?: Record<string, any>;
  fetchedAt?: string;
};

const statusVariant = (status: string): any => {
  if (/complete/i.test(status)) return 'success';
  if (/running|queue|submit/i.test(status)) return 'warning';
  if (/fail|error|stop/i.test(status)) return 'error';
  return 'neutral';
};

function metric(design: BackendRun['designs'] extends Array<infer D> ? any : any, key: string, digits = 1) {
  const value = design?.metrics?.[key];
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : String(value);
}

export function BackendDrawer({ app, open, onClose }: { app: any; open: boolean; onClose: () => void }) {
  const [jobsData, setJobsData] = useState<JobsResponse | null>(null);
  const [runs, setRuns] = useState<BackendRun[]>([]);
  const [run, setRun] = useState<BackendRun | null>(null);
  const selectedRunRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [form, setForm] = useState({
    pdbFile: '',
    chain: 'A',
    hotspots: '62,63',
    framework: 'vobarilizumab',
    designs: 8,
    effort: 'thinking_high',
    steps: 60,
    seed: 20261112,
  });

  const refresh = async (selectLatest = false, force = false) => {
    setLoading(true);
    setError('');
    try {
      const [remote, local] = await Promise.all([
        api<JobsResponse>(`/api/tamarind/jobs?limit=100${force ? '&refresh=1' : ''}`),
        api<{ runs: BackendRun[] }>('/api/runs?limit=50'),
      ]);
      setJobsData(remote);
      setRuns(local.runs);
      if (remote.defaults) {
        setForm((prev) => ({
          ...prev,
          pdbFile: remote.defaults.pdbFile || prev.pdbFile,
          chain: (remote.defaults.targetChains || [prev.chain])[0] || prev.chain,
          hotspots: remote.defaults.hotspotResidues?.[(remote.defaults.targetChains || [prev.chain])[0]] || prev.hotspots,
          framework: remote.defaults.nanobodyFramework || prev.framework,
          designs: remote.defaults.numDesigns || prev.designs,
          effort: remote.defaults.samplingEffort || prev.effort,
          steps: remote.defaults.samplingSteps || prev.steps,
          seed: remote.defaults.seed || prev.seed,
        }));
      }
      const target = remote.latestDesignJob && remote.imported.find((i) => i.jobName === remote.latestDesignJob?.jobName);
      if ((selectLatest || !selectedRunRef.current) && local.runs.length) {
        const id = target?.runId || local.runs[0].id;
        await selectRun(id);
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const timer = window.setInterval(() => refresh(false), 15000);
    return () => window.clearInterval(timer);
  }, [open]);

  const selectRun = async (id: string, scroll = false) => {
    try {
      selectedRunRef.current = id;
      const detail = await api<BackendRun>(`/api/runs/${encodeURIComponent(id)}`);
      setRun(detail);
      if (scroll) {
        window.setTimeout(() => {
          document.getElementById('bd-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
      return detail;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  };

  const viewDesign = async (design: BackendRun['designs'] extends Array<infer D> ? any : any) => {
    if (!design) return;
    setBusy(`view-${design.id}`);
    setError('');
    try {
      const structure = await api<any>(`/api/designs/${encodeURIComponent(design.id)}/structure`);
      app.setRealDesign(structure);
      app.setProjectName(`RFD4 · ${design.designId}`);
      app.toast(`Loaded ${design.designId} into the monitor`);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const openRun = async (id: string) => {
    const detail = await selectRun(id, true);
    const best = detail?.designs?.[0];
    if (best) await viewDesign(best);
  };

  const importLatest = async () => {
    setBusy('import');
    setError('');
    setNotice('');
    try {
      const result = await api<any>('/api/tamarind/import-latest', { method: 'POST', body: {} });
      setNotice(result.alreadyImported ? 'Latest job was already imported.' : `Imported ${result.run?.designs?.length || 0} designs from ${result.job?.jobName}.`);
      await refresh(true);
      if (result.run?.id) await selectRun(result.run.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const importJob = async (job: TamarindJob) => {
    setBusy(job.jobName);
    setError('');
    setNotice('');
    try {
      const result = await api<any>('/api/tamarind/import', { method: 'POST', body: { jobName: job.jobName } });
      setNotice(`Imported ${result.run?.designs?.length || 0} designs from ${job.jobName}.`);
      await refresh(true);
      if (result.run?.id) await selectRun(result.run.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const settings = () => ({
    task: 'nanobody-design',
    modelCheckpoint: 'antibody-2026-10-30',
    pdbFile: form.pdbFile,
    targetChains: [form.chain],
    hotspotResidues: { [form.chain]: form.hotspots },
    nanobodyFramework: form.framework,
    numDesigns: Number(form.designs) || 1,
    samplingEffort: form.effort,
    samplingSteps: Number(form.steps) || 60,
    frameworkAtoms: 'backbone',
    repackTargetInterface: true,
    hotspotAtoms: 'single-atom',
    preOracleFilters: true,
    refoldDesigns: true,
    seed: Number(form.seed) || 20261112,
  });

  const validate = async () => {
    setBusy('validate');
    setValidation(null);
    setError('');
    try {
      const result = await api<any>('/api/tamarind/validate', { method: 'POST', body: { settings: settings() } });
      setValidation(result);
      if (!result.valid) setError(result.error || 'RFD4 settings are invalid.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    if (!confirmed) {
      setError('Enable the real-job confirmation before submitting.');
      return;
    }
    setBusy('submit');
    setError('');
    setNotice('');
    try {
      const result = await api<any>('/api/tamarind/submit', { method: 'POST', body: { settings: settings() } });
      setValidation(result.validation);
      if (!result.submitted) {
        setError(result.validation?.error || 'Tamarind rejected the job.');
      } else {
        setNotice(`Submitted ${result.jobName}. Polling Tamarind for status…`);
        setConfirmed(false);
        await refresh(true);
        if (result.run?.id) await selectRun(result.run.id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const importedFor = (jobName: string) => jobsData?.imported.find((i) => i.jobName === jobName);

  return (
    <div className={`backend-scrim ${open ? 'open' : ''}`} onClick={onClose}>
      <aside className="backend-drawer" onClick={(e) => e.stopPropagation()} aria-label="Tamarind backend">
        <header className="bd-head">
          <div>
            <div className="bd-kicker">PERSISTENT BACKEND · SQLITE</div>
            <h2>Tamarind runs</h2>
            <p>RFD4-Proteina executor · server-side API key · job and design persistence</p>
          </div>
          <div className="bd-head-actions">
            <Button label="Refresh" variant="secondary" size="sm" icon={<Glyph name="refresh" size={12} />} onClick={() => refresh(false, true)} isLoading={loading} className="ll-astryx-button" />
            <IconButton label="Close runs" icon={<Glyph name="close" size={14} />} variant="ghost" size="sm" onClick={onClose} className="ll-astryx-icon" />
          </div>
        </header>

        <div className="bd-body">
          <section className="bd-status">
            <div className="bd-status-row">
              <span className={`bd-led ${jobsData?.configured ? 'on' : ''}`} />
              <span>{jobsData?.configured ? 'Tamarind connected' : 'Tamarind not configured'}</span>
              <Badge label="RFD4" variant="purple" />
              <Badge label={`${runs.length} persisted run${runs.length === 1 ? '' : 's'}`} variant="neutral" />
            </div>
            <code>{jobsData?.fetchedAt ? `last checked ${formatJobDate(jobsData.fetchedAt)}` : 'checking…'}</code>
          </section>

          {error && <div className="bd-alert error">{error}</div>}
          {notice && <div className="bd-alert success">{notice}</div>}

          <section className="bd-section">
            <div className="bd-section-head">
              <h3>Latest design job</h3>
              <span>test case</span>
            </div>
            {jobsData?.latestDesignJob ? (
              <div className="bd-latest-card">
                <div className="bd-latest-title">
                  <strong>{jobsData.latestDesignJob.jobName}</strong>
                  <Badge label={jobsData.latestDesignJob.status} variant={statusVariant(jobsData.latestDesignJob.status)} />
                </div>
                <div className="bd-meta-grid">
                  <span>Type <b>{jobsData.latestDesignJob.type}</b></span>
                  <span>Created <b>{formatJobDate(jobsData.latestDesignJob.created)}</b></span>
                  <span>Task <b>{jobsData.latestDesignJob.task || '—'}</b></span>
                  <span>Designs <b>{jobsData.latestDesignJob.numDesigns ?? '—'}</b></span>
                </div>
                <div className="bd-actions">
                  <Button label="Import latest into SQLite" variant="primary" size="sm" icon={<Glyph name="database" size={12} />} onClick={importLatest} isLoading={busy === 'import'} className="ll-astryx-button" />
                  {importedFor(jobsData.latestDesignJob.jobName) && (
                    <Button label="Open persisted run" variant="secondary" size="sm" onClick={() => openRun(importedFor(jobsData.latestDesignJob!.jobName)!.runId)} className="ll-astryx-button" />
                  )}
                </div>
              </div>
            ) : (
              <div className="bd-empty">{loading ? 'Checking Tamarind…' : 'No completed RFD4 job found.'}</div>
            )}
          </section>

          <section className="bd-section">
            <div className="bd-section-head"><h3>Tamarind jobs</h3><span>{jobsData?.jobs.length || 0} jobs</span></div>
            <div className="bd-job-list">
              {(jobsData?.jobs || []).map((job) => {
                const imported = importedFor(job.jobName);
                return (
                  <div className={`bd-job ${imported ? 'is-imported' : ''}`} key={job.jobName}>
                    <div className="bd-job-main">
                      <div className="bd-job-name">{job.jobName}</div>
                      <div className="bd-job-meta">
                        {formatJobDate(job.created)} · {job.type} {job.numDesigns ? `· ${job.numDesigns} designs` : ''}
                      </div>
                    </div>
                    <Badge label={job.status} variant={statusVariant(job.status)} />
                    {imported ? (
                      <button className="bd-link" onClick={() => selectRun(imported.runId, true)}>Open</button>
                    ) : (
                      <button className="bd-link" onClick={() => importJob(job)} disabled={busy === job.jobName}>
                        {busy === job.jobName ? 'Importing…' : 'Import'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bd-section">
            <div className="bd-section-head"><h3>Persisted runs</h3><span>SQLite</span></div>
            <div className="bd-run-list">
              {runs.map((item) => (
                <button className={`bd-run ${run?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectRun(item.id, true)}>
                  <span className={`bd-run-led ${/complete/i.test(item.status) ? 'done' : ''}`} />
                  <span className="bd-run-main">
                    <strong>{item.jobName}</strong>
                    <span>{item.source} · {formatJobDate(item.createdAt)}</span>
                  </span>
                  <span className="bd-run-count">{item.designCount} designs</span>
                </button>
              ))}
              {!runs.length && <div className="bd-empty">No runs persisted yet. Import the latest job above.</div>}
            </div>
          </section>

          {run && (
            <section className="bd-section bd-detail" id="bd-detail">
              <div className="bd-section-head"><h3>Designs · {run.jobName}</h3><span>{run.designCount} rows</span></div>
              <div className="bd-run-summary">
                <span>status <b>{run.status}</b></span>
                <span>best ipTM <b>{run.summary?.bestIpTM ?? '—'}</b></span>
                <span>best pLDDT <b>{run.summary?.bestPLDDT ?? '—'}</b></span>
                <span>passed <b>{run.summary?.passedCount ?? 0}/{run.summary?.designCount ?? run.designCount}</b></span>
              </div>
              <div className="bd-design-list">
                {(run.designs || []).map((design) => (
                  <div className="bd-design" key={design.id}>
                    <div className="bd-design-head">
                      <span className="bd-rank">{design.rank}</span>
                      <strong>{design.designId}</strong>
                      <span className="bd-design-len">{design.sequence.length} aa</span>
                      <button className="bd-link bd-view3d" onClick={() => viewDesign(design)} disabled={busy === `view-${design.id}`}>
                        {busy === `view-${design.id}` ? 'Loading…' : 'View 3D'}
                      </button>
                      <a className="bd-link" href={pdbUrl(design.id)} download>PDB ↓</a>
                    </div>
                    <div className="bd-design-metrics">
                      <span>ipTM <b>{metric(design, 'oracle_ppi.iptm_coi')}</b></span>
                      <span>pLDDT <b>{metric(design, 'oracle_ppi.plddt_coi', 2)}</b></span>
                      <span>RMSD <b>{metric(design, 'refolded_backbone_rmsd.rmsd', 2)} Å</b></span>
                      <span>passed <b>{design.metrics.passed === '1' ? 'yes' : 'no'}</b></span>
                    </div>
                    <code className="bd-sequence">{design.sequence.slice(0, 42)}…</code>
                    {design.cdrSequences && (
                      <div className="bd-cdrs">
                        {Object.entries(design.cdrSequences).map(([key, value]) => (
                          <span key={key}><b>{key}</b> {value}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {run.events?.length > 0 && (
                <div className="bd-events">
                  {run.events.slice(-3).map((event) => (
                    <div className={`bd-event ${event.level}`} key={event.id}>
                      <span>{formatJobDate(event.createdAt)}</span> {event.message}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="bd-section">
            <div className="bd-section-head"><h3>Submit RFD4-Proteina</h3><span>real GPU job</span></div>
            <div className="bd-form">
              <TextInput label="Target PDB (Tamarind path)" size="sm" value={form.pdbFile} onChange={(v) => setForm({ ...form, pdbFile: v })} containerClassName="ll-field-astryx" />
              <div className="bd-form-grid">
                <TextInput label="Target chain" size="sm" value={form.chain} onChange={(v) => setForm({ ...form, chain: v })} containerClassName="ll-field-astryx" />
                <TextInput label="Hotspots" size="sm" value={form.hotspots} onChange={(v) => setForm({ ...form, hotspots: v })} containerClassName="ll-field-astryx" />
                <TextInput label="Designs" size="sm" value={String(form.designs)} onChange={(v) => setForm({ ...form, designs: Number(v) || 1 })} inputMode="numeric" containerClassName="ll-field-astryx" />
                <TextInput label="Seed" size="sm" value={String(form.seed)} onChange={(v) => setForm({ ...form, seed: Number(v) || 0 })} inputMode="numeric" containerClassName="ll-field-astryx" />
              </div>
              <div className="bd-form-grid">
                <label className="bd-select"><span>Framework</span>
                  <select value={form.framework} onChange={(e) => setForm({ ...form, framework: e.target.value })}>
                    {['vobarilizumab', 'caplacizumab', 'ozoralizumab', 'h-nbbcii10'].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </label>
                <label className="bd-select"><span>Effort</span>
                  <select value={form.effort} onChange={(e) => setForm({ ...form, effort: e.target.value })}>
                    {['thinking_medium', 'thinking_high'].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </label>
                <TextInput label="Steps" size="sm" value={String(form.steps)} onChange={(v) => setForm({ ...form, steps: Number(v) || 60 })} inputMode="numeric" containerClassName="ll-field-astryx" />
              </div>
              <div className="bd-submit-row">
                <Switch label="I understand this submits a real Tamarind job" size="sm" value={confirmed} onChange={setConfirmed} />
                <div className="bd-actions">
                  <Button label="Validate only" variant="secondary" size="sm" icon={<Glyph name="check" size={12} />} onClick={validate} isLoading={busy === 'validate'} className="ll-astryx-button" />
                  <Button label="Submit RFD4" variant="primary" size="sm" icon={<Glyph name="play" size={12} />} onClick={submit} isDisabled={!confirmed} isLoading={busy === 'submit'} className="ll-astryx-button" />
                </div>
              </div>
              {validation && (
                <div className={`bd-validation ${validation.valid ? 'ok' : 'error'}`}>
                  <Glyph name={validation.valid ? 'check' : 'alert'} size={11} />
                  {validation.valid ? 'Validation passed — settings are ready to submit.' : validation.error}
                </div>
              )}
              <p className="bd-note">The API key stays in the server-side <code>.env</code>. The browser only talks to this backend. The latest job is imported from Tamarind’s presigned result ZIP and stored as designs + PDB in SQLite.</p>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
