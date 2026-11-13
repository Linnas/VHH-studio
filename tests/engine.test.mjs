import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultProject, makeProject, projectDuration, getModel, TARGETS,
} from '../src/engine/models.js';
import { compile } from '../src/engine/compiler.js';
import { Engine } from '../src/engine/runtime.js';
import { toPDB, toFasta, toCSV } from '../src/engine/structure.js';

test('default project compiles into a valid typed DAG', () => {
  const project = defaultProject();
  const result = compile(project);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.nodes.filter((n) => n.model).length, 8);
  assert.ok(result.edges.length >= 7);
  assert.ok(result.edges.some((e) => e.type === 'epitope'));
  assert.ok(result.edges.some((e) => e.type === 'backbone'));
  assert.ok(result.edges.some((e) => e.type === 'sequence'));
});

test('missing epitope breaks backbone generation with a clear diagnostic', () => {
  const project = defaultProject();
  project.clips = project.clips.filter((c) => c.modelId !== 'epitope-scan');
  const result = compile(project);
  assert.equal(result.valid, false);
  const error = result.errors.find((e) => e.code === 'missing-input' && e.type === 'epitope');
  assert.ok(error);
  assert.match(error.message, /RFdiffusion needs Epitope selection/i);
});

test('a downstream clip that starts too early is rejected', () => {
  const project = defaultProject();
  const mpnn = project.clips.find((c) => c.modelId === 'proteinmpnn');
  mpnn.start = 5;
  const result = compile(project);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.clipId === mpnn.id && e.type === 'backbone'));
});

test('templates compile cleanly', () => {
  for (const id of ['egfr-denovo', 'pdl1-proteina', 'her2-sprint']) {
    const project = makeProject(id);
    const result = compile(project);
    assert.equal(result.valid, true, `${id} should compile`);
    assert.ok(project.clips.length >= 6);
  }
});

test('project duration is stable and only grows to fit clips', () => {
  const project = defaultProject();
  const startDuration = project.duration;
  assert.equal(projectDuration(project), startDuration);
  const last = project.clips[project.clips.length - 1];
  last.start = startDuration + 2;
  assert.ok(projectDuration(project) >= startDuration + 2);
});

test('engine produces deterministic structural + sequence artifacts', () => {
  const project = defaultProject();
  const a = new Engine(project);
  const b = new Engine(project);
  const ra = a.results(project.duration);
  const rb = b.results(project.duration);
  assert.equal(ra.length, 4);
  assert.deepEqual(ra.map((d) => d.id), rb.map((d) => d.id));
  assert.deepEqual(ra.map((d) => d.seq), rb.map((d) => d.seq));
  assert.deepEqual(ra.map((d) => d.score), rb.map((d) => d.score));

  const sa = a.preview(project.duration).structure;
  const sb = b.preview(project.duration).structure;
  assert.equal(sa.vhh.residues.length, sb.vhh.residues.length);
  assert.equal(sa.vhh.residues[0].x, sb.vhh.residues[0].x);
  assert.equal(sa.epitope.area, sb.epitope.area);
});

test('preview exposes the expected staged state', () => {
  const project = defaultProject();
  const engine = new Engine(project);

  const atZero = engine.preview(0);
  assert.equal(atZero.hasBackbone, false);

  const atNine = engine.preview(9);
  assert.equal(atNine.hasBackbone, true);
  assert.equal(atNine.hasSequence, false);

  const atTwelve = engine.preview(12);
  assert.equal(atTwelve.hasSequence, true);
  assert.ok(atTwelve.designs.length >= 1);

  const final = engine.preview(project.duration);
  assert.equal(final.hasComplex, true);
  assert.ok(final.deliverable);
  assert.ok(final.metrics);
  assert.ok(final.structure.vhh.regions.some((r) => r.key === 'cdr3'));
});

test('design metrics stay in plausible, clearly-simulated ranges', () => {
  const project = defaultProject();
  const designs = new Engine(project).results(project.duration);
  for (const d of designs) {
    assert.ok(d.metrics.ipTM >= 0.6 && d.metrics.ipTM <= 1);
    assert.ok(d.metrics.dockq >= 0 && d.metrics.dockq <= 1);
    assert.ok(d.metrics.pLDDT >= 0 && d.metrics.pLDDT <= 100);
    assert.ok(d.metrics.humanness >= 0 && d.metrics.humanness <= 100);
    assert.ok(d.seq.length === d.length);
    assert.ok(d.cdr3.length > 0);
  }
});

test('exporters emit FASTA, CSV and a provenance-labelled PDB', () => {
  const project = defaultProject();
  const engine = new Engine(project);
  const payload = engine.exportPayload(project.duration);
  const design = payload.designs[0];

  const fasta = toFasta(payload.designs, project);
  assert.equal((fasta.match(/^>/gm) || []).length, payload.designs.length);
  assert.match(fasta, /runtime=simulation/);

  const csv = toCSV(payload.designs);
  assert.match(csv, /rank,id,score,length,ipTM/);
  assert.equal(csv.trim().split('\n').length, payload.designs.length + 1);

  const pdb = toPDB(payload.structure, design, project);
  assert.match(pdb, /SIMULATION OUTPUT/);
  assert.match(pdb, /^ATOM/m);
  assert.match(pdb, /^END/m);
  assert.ok(pdb.includes(' CA  '));
});

test('models declare typed inputs and outputs', () => {
  for (const id of ['rfdiffusion', 'proteina', 'proteinmpnn', 'antifold', 'esmfold', 'boltz2', 'dockq', 'nanofilter', 'deliver']) {
    const model = getModel(id);
    assert.ok(model, `${id} exists`);
    assert.ok(model.output, `${id} declares an output`);
    assert.ok(Array.isArray(model.inputs), `${id} declares inputs`);
    assert.ok(model.params.length > 0, `${id} exposes parameters`);
  }
  assert.ok(TARGETS.egfr.hotspots.includes('R353'));
});
