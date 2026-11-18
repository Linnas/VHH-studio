import { spawn, execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCaTrace } from './pdb.js';

const ACTIVE = /^(running|queued|starting|submitted)$/i;

function wslPath(input) {
  if (!input) return input;
  const value = String(input);
  if (value.startsWith('/')) return value.replace(/\\/g, '/');
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (match) return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
  return value.replace(/\\/g, '/');
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function walkFiles(dir, output = []) {
  if (!existsSync(dir)) return output;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, output);
    else output.push(full);
  }
  return output;
}

export class LocalRFD4 {
  constructor({ config, store, logger = console }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.jobs = new Map();
    this.configured = Boolean(config.enabled);
  }

  async probe() {
    if (!this.configured) return { configured: false, available: false, reason: 'LOCAL_RFD4_ENABLED=0' };
    const venvBin = `${wslPath(this.config.venv).replace(/\/+$/, '')}/bin`;
    return new Promise((resolveProbe) => {
      const command = `test -x ${quote(this.config.repo)} && test -x ${quote(`${venvBin}/rfd4-generate`)} && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader`;
      execFile(this.config.wsl, ['-d', this.config.distro, '--', 'bash', '-lc', command], { timeout: 12000 }, (error, stdout) => {
        const line = String(stdout || '').trim();
        const [gpu, memory, driver] = line.split(',').map((part) => part.trim());
        resolveProbe({
          configured: true,
          available: !error,
          distro: this.config.distro,
          repo: this.config.repo,
          runsDir: this.config.runsDir,
          defaultSpec: this.config.defaultSpec,
          defaultConfigPath: this.config.defaultConfigPath,
          defaultConfigName: this.config.defaultConfigName,
          gpu: gpu || null,
          memory: memory || null,
          driver: driver || null,
          error: error ? String(error.message || error) : null,
        });
      });
    });
  }

  async submit({ specPath, numDesigns = 1, name, configPath, configName, targetChains = ['A'], seed = 20261112, compile = false }) {
    if (!this.configured) throw new Error('Local RFD4 is not configured');
    const spec = String(specPath || this.config.defaultSpec || '').trim();
    if (!spec) throw new Error('specPath is required');
    const jobName = name || `local-rfd4-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    const jobDir = join(this.config.runsDir, jobName);
    mkdirSync(jobDir, { recursive: true });
    const settings = {
      specPath: spec,
      numDesigns: Math.max(1, Number(numDesigns) || 1),
      configPath: configPath || this.config.defaultConfigPath,
      configName: configName || this.config.defaultConfigName,
      targetChains,
      seed,
      compile,
    };
    const run = this.store.saveRun({
      externalId: jobName,
      provider: 'local-rfd4',
      type: 'rfd4-proteina',
      task: 'nanobody-design',
      status: 'Running',
      statusDetail: 'Local RFD4 process started',
      settings,
      source: 'local-submit',
    });
    this.store.addEvent(run.id, `Starting local RFD4: ${jobName}`, 'info');

    const setup = [
      `cd ${quote(this.config.repo)}`,
      `. ${quote(`${wslPath(this.config.venv).replace(/\/+$/, '')}/bin/activate`)}`,
      `export PROJECT_ROOT=${quote(this.config.repo)}`,
      `export TORCHDYNAMO_DISABLE=1`,
      `export TORCH_COMPILE_DISABLE=1`,
    ];
    const args = [
      `--config-path ${quote(settings.configPath)}`,
      `--config-name ${quote(settings.configName)}`,
      `inputs=${quote(wslPath(spec))}`,
      `num_replicates=${settings.numDesigns}`,
      `batch_size=1`,
      `seed=${Number(seed) || 20261112}`,
      `out_dir=${quote(wslPath(jobDir))}`,
      compile ? null : 'compile_lengths=null',
      `'~metrics'`,
    ].filter(Boolean);
    const command = `${setup.join(' && ')} && rfd4-generate ${args.join(' ')}`;

    const log = createWriteStream(join(jobDir, 'job.log'), { flags: 'a' });
    log.write(`# ${new Date().toISOString()}\n$ ${command}\n`);
    const child = spawn(this.config.wsl, ['-d', this.config.distro, '--', 'bash', '-lc', command], {
      windowsHide: true,
      env: { ...process.env, WSLENV: '' },
    });
    this.jobs.set(run.id, { child, jobDir, log });
    child.stdout?.on('data', (chunk) => log.write(chunk));
    child.stderr?.on('data', (chunk) => log.write(chunk));
    child.on('error', (error) => {
      log.write(`\n[spawn error] ${error.message}\n`);
      log.end();
      this.store.saveRun({ ...run, status: 'Failed', statusDetail: 'Local process failed to start', error: error.message });
      this.store.addEvent(run.id, `Local RFD4 failed to start: ${error.message}`, 'error');
      this.jobs.delete(run.id);
    });
    child.on('close', (code) => {
      log.write(`\n[exit ${code}]\n`);
      log.end();
      this.finish(run.id, jobName, jobDir, code).catch((error) => {
        this.logger.warn?.('Local RFD4 import failed:', error.message);
        const current = this.store.getRun(run.id);
        if (current) {
          this.store.saveRun({
            ...current,
            status: 'Failed',
            statusDetail: 'Local result import failed',
            error: error.message,
          });
          this.store.addEvent(run.id, `Local RFD4 import failed: ${error.message}`, 'error');
        }
      }).finally(() => this.jobs.delete(run.id));
    });

    return { submitted: true, run: this.store.getRunDetail(run.id), jobDir };
  }

  async finish(runId, jobName, jobDir, code) {
    const run = this.store.getRun(runId);
    if (!run) return;
    if (code !== 0) {
      this.store.saveRun({
        ...run,
        status: 'Failed',
        statusDetail: `Local process exited with code ${code}`,
        error: `Local RFD4 exited with code ${code}`,
      });
      this.store.addEvent(runId, `Local RFD4 failed with exit code ${code}`, 'error');
      return;
    }
    const files = walkFiles(jobDir);
    const cifs = files.filter((file) => extname(file).toLowerCase() === '.cif' && !/refold/i.test(file));
    if (cifs.length) await this.convertCifs(jobDir);
    const pdbs = walkFiles(jobDir).filter((file) => extname(file).toLowerCase() === '.pdb');
    if (!pdbs.length) {
      this.store.saveRun({
        ...run,
        status: 'Failed',
        statusDetail: 'No CIF/PDB designs produced',
        error: 'RFD4 completed but no CIF/PDB output was found',
      });
      this.store.addEvent(runId, 'Local RFD4 completed without designs', 'error');
      return;
    }
    const targetChains = run.settings?.targetChains || ['A'];
    const designs = [];
    for (const file of pdbs.sort()) {
      const pdb = readFileSync(file, 'utf8');
      let trace;
      try {
        trace = parseCaTrace(pdb, { targetChains });
      } catch (error) {
        this.logger.warn?.(`Could not parse ${file}:`, error.message);
        continue;
      }
      const binder = trace.chains.find((chain) => chain.role === 'binder') || trace.chains[trace.chains.length - 1];
      if (!binder) continue;
      designs.push({
        designId: file.replace(/\\/g, '/').split('/').pop().replace(/\.pdb$/i, ''),
        sequence: binder.sequence,
        cdrSequences: {},
        pdb,
        metrics: {},
        rank: designs.length + 1,
      });
    }
    if (!designs.length) {
      this.store.saveRun({
        ...run,
        status: 'Failed',
        statusDetail: 'Could not parse RFD4 structures',
        error: 'No parseable PDB structures were produced',
      });
      this.store.addEvent(runId, 'Local RFD4 output could not be parsed', 'error');
      return;
    }
    this.store.replaceDesigns(runId, designs);
    this.store.saveRun({
      ...run,
      status: 'Complete',
      statusDetail: `${designs.length} local designs`,
      summary: { designCount: designs.length, bestDesignId: designs[0].designId, local: true },
      completedAt: new Date().toISOString(),
    });
    this.store.addEvent(runId, `Imported ${designs.length} designs from local RFD4 ${jobName}`, 'success');
  }

  async convertCifs(jobDir) {
    const root = wslPath(jobDir);
    const script = `import gemmi, pathlib
root = pathlib.Path(${JSON.stringify(root)})
for f in sorted(root.rglob('*.cif')):
    if 'refold' in [p.lower() for p in f.parts]:
        continue
    st = gemmi.read_structure(str(f))
    st.setup_entities()
    st.write_pdb(str(f.with_suffix('.pdb')))
    print(str(f.with_suffix('.pdb')))
`;
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    const command = `cd ${quote(this.config.repo)} && . ${quote(`${wslPath(this.config.venv).replace(/\/+$/, '')}/bin/activate`)} && python -c "import base64; exec(base64.b64decode('${encoded}'))"`;
    await new Promise((resolveConvert, rejectConvert) => {
      execFile(this.config.wsl, ['-d', this.config.distro, '--', 'bash', '-lc', command], { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) rejectConvert(new Error(`CIF conversion failed: ${error.message}\n${stderr || ''}`));
        else resolveConvert(stdout);
      });
    });
  }

  async recoverInterrupted() {
    const runs = this.store.listRuns(100).filter((run) => run.provider === 'local-rfd4' && ACTIVE.test(run.status));
    for (const run of runs) {
      this.store.saveRun({
        ...run,
        status: 'Interrupted',
        statusDetail: 'Local process was interrupted by a server restart',
        error: 'Local RFD4 process was interrupted',
      });
      this.store.addEvent(run.id, 'Local RFD4 interrupted by server restart', 'warn');
    }
  }

  async getRunLog(runId) {
    const run = this.store.getRun(runId);
    if (!run) return null;
    const file = join(this.config.runsDir, run.jobName, 'job.log');
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }
}
