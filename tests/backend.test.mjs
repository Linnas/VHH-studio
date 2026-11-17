import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../backend/db.js';
import { normalizeJob, parseCsv, parseCdrSequences, pickLatestDesignJob } from '../backend/tamarind.js';
import { parseCaTrace } from '../backend/pdb.js';
import { defaultRfd4Settings } from '../backend/runner.js';

test('SQLite persists projects, runs and designs across store instances', () => {
  const store = new Store(':memory:');
  store.saveProject('prj_test', 'Test program', { name: 'Test program', clips: [] });
  const project = store.getProject('prj_test');
  assert.equal(project.name, 'Test program');
  assert.equal(store.listProjects().length, 1);

  const run = store.saveRun({
    externalId: 'job-test',
    status: 'Complete',
    type: 'rfd4-proteina',
    summary: { designCount: 2, bestIpTM: 88 },
  });
  store.replaceDesigns(run.id, [
    { designId: 'design_2', sequence: 'QVQLV', metrics: { 'oracle_ppi.iptm_coi': '88' }, rank: 1 },
    { designId: 'design_1', sequence: 'EVQLV', metrics: { 'oracle_ppi.iptm_coi': '70' }, rank: 2 },
  ]);
  const detail = store.getRunDetail(run.id);
  assert.equal(detail.designs.length, 2);
  assert.equal(detail.designs[0].designId, 'design_2');
  assert.equal(store.stats().designs, 2);
  assert.equal(store.getRunByExternalId('job-test').id, run.id);
  store.close();
});

test('CSV parser handles quoted values and CDR annotations', () => {
  const rows = parseCsv('design_id,sequence,note\r\n001,EVQLV,\"a,b\"\r\n002,QVQLV,plain\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].note, 'a,b');
  assert.equal(rows[1].sequence, 'QVQLV');
  const cdrs = parseCdrSequences('H-CDR1:AAAG;H-CDR2:BBBB;H-CDR3:CCCC');
  assert.deepEqual(cdrs, { 'H-CDR1': 'AAAG', 'H-CDR2': 'BBBB', 'H-CDR3': 'CCCC' });
});

test('latest design job is selected from the two real Tamarind jobs', () => {
  const jobs = [
    normalizeJob({ JobName: 'vakmg', JobStatus: 'Complete', Type: 'rfd4-proteina', Created: '2026-11-12 05:35:51' }),
    normalizeJob({ JobName: 'vhh-1aki-w62-w63-vobar-rfd4-20261112', JobStatus: 'Complete', Type: 'rfd4-proteina', Created: '2026-11-12 05:52:04' }),
  ];
  const latest = pickLatestDesignJob(jobs);
  assert.equal(latest.jobName, 'vhh-1aki-w62-w63-vobar-rfd4-20261112');
  assert.equal(latest.type, 'rfd4-proteina');
});

test('RFD4 defaults are submittable and keep the known test-target path', () => {
  const settings = defaultRfd4Settings({
    settings: {
      pdbFile: 'demo/1AKI_trimmed.pdb',
      targetChains: ['A'],
      hotspotResidues: { A: '62,63' },
      nanobodyFramework: 'vobarilizumab',
    },
  });
  assert.equal(settings.task, 'nanobody-design');
  assert.equal(settings.pdbFile, 'demo/1AKI_trimmed.pdb');
  assert.deepEqual(settings.targetChains, ['A']);
  assert.deepEqual(settings.hotspotResidues, { A: '62,63' });
  assert.equal(settings.keepConstantDomains, undefined);
});

test('PDB CA parser separates target and binder and maps CDR ranges', () => {
  const line = (chain, seq, res, x) => `ATOM      1  CA  ${res} ${chain}${String(seq).padStart(4, ' ')}    ${x.toFixed(3).padStart(8, ' ')}   0.000   0.000  1.00  0.00           C`;
  const pdb = [
    line('A', 1, 'ALA', 0),
    line('A', 2, 'GLY', 1),
    line('H', 1, 'GLU', 5),
    line('H', 2, 'VAL', 6),
    line('H', 3, 'GLN', 7),
    line('H', 4, 'LEU', 8),
  ].join('\n');
  const trace = parseCaTrace(pdb, {
    targetChains: ['A'],
    designedSequence: 'EVQL',
    cdrSequences: { 'H-CDR1': 'VQL' },
  });
  assert.equal(trace.chains.length, 2);
  assert.equal(trace.binderChain, 'H');
  assert.deepEqual(trace.targetChains, ['A']);
  assert.equal(trace.chains.find((c) => c.id === 'H').sequence, 'EVQL');
  assert.deepEqual(trace.chains.find((c) => c.id === 'H').cdrs[0], { key: 'H-CDR1', start: 1, end: 3, });
  assert.equal(trace.chains.find((c) => c.id === 'H').atoms[0].ss, 'loop');
  assert.equal(trace.chains.find((c) => c.id === 'H').residues.length, 4);
  assert.equal(trace.chains.find((c) => c.id === 'H').residues[0].atoms[0].name, 'CA');
  assert.deepEqual(trace.ssSummary, { helix: 0, sheet: 0, loop: 6 });
});
