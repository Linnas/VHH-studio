/* Playhead-driven simulated runtime.
   Real adapters implement the same artifact contract; this runtime exists so the
   NLE interaction model can be evaluated without a GPU. Every output is clearly
   labelled as simulated in the UI and in exported files. */

import { compile } from './compiler.js';
import { MODEL_BY_ID, projectDuration } from './models.js';
import { buildComplex, makeDesigns, annotateStructure } from './structure.js';
import { hashString } from './rng.js';

const EPS = 0.02;

export class Engine {
  constructor(project) {
    this.project = project;
    this.result = null;
    this.artifacts = new Map();
    this.structureCache = new Map();
    this.seen = new Set();
    this.errors = new Map();
    this.setProject(project);
  }

  setProject(project) {
    this.project = project;
    this.result = compile(project);
    this.nodesById = new Map(this.result.nodes.map((n) => [n.id, n]));
    this._dirty = false;
    if (!this.artifacts) this.artifacts = new Map();
    this.invalidate();
  }

  invalidate() {
    this.artifacts.clear();
    this.structureCache.clear();
    this.seen.clear();
    this.errors.clear();
  }

  fingerprint(node) {
    const inputs = (node.wiring || []).map((w) => w.producerId || 'seed').join('>');
    return hashString(JSON.stringify({ m: node.modelId, p: node.params, s: this.project.seed, t: this.project.target?.id, inputs }));
  }

  baseStructure() {
    const key = `base:${this.project.seed}:${this.project.target?.id}`;
    if (!this.structureCache.has(key)) {
      this.structureCache.set(key, buildComplex(this.project, null));
    }
    return this.structureCache.get(key);
  }

  structureFor(node) {
    if (!node) return this.baseStructure();
    const key = `bb:${node.id}:${JSON.stringify(node.params)}:${this.project.seed}`;
    if (!this.structureCache.has(key)) {
      this.structureCache.set(key, buildComplex(this.project, node));
    }
    return this.structureCache.get(key);
  }

  getInput(node, type) {
    const wire = (node.wiring || []).find((w) => w.type === type);
    if (!wire) return null;
    if (wire.kind === 'seed') return { kind: 'target', target: this.project.target };
    if (!wire.producerId) return null;
    const producer = this.nodesById.get(wire.producerId);
    if (!producer) return null;
    return this.ensureArtifact(producer);
  }

  ensureArtifact(node) {
    if (!node || !node.model) return null;
    const fp = this.fingerprint(node);
    const cached = this.artifacts.get(node.id);
    if (cached && cached.fp === fp) return cached.artifact;
    const started = performance.now();
    let artifact;
    try {
      artifact = this.computeArtifact(node);
    } catch (err) {
      this.errors.set(node.id, err.message);
      artifact = { kind: 'error', message: err.message };
    }
    artifact.fp = fp;
    artifact.clipId = node.id;
    artifact.modelName = node.model.name;
    artifact.durationMs = Math.max(1, Math.round(performance.now() - started));
    this.artifacts.set(node.id, { fp, artifact });
    return artifact;
  }

  computeArtifact(node) {
    const m = node.model;
    const params = node.params || {};
    switch (m.id) {
      case 'target-intake': {
        const structure = this.baseStructure();
        return {
          kind: 'target',
          label: `${this.project.target?.name || 'Target'} · ${params.pdb || 'demo'}`,
          target: this.project.target,
          points: structure.antigen.points.length,
          note: 'Surface prepared for epitope mapping',
        };
      }
      case 'epitope-scan': {
        const structure = this.baseStructure();
        const hotspots = String(params.hotspots || '').split(',').map((s) => s.trim()).filter(Boolean);
        return {
          kind: 'epitope',
          label: `${hotspots.length} hotspots · ${structure.epitope.area} Å² patch`,
          hotspots,
          area: structure.epitope.area,
          patchSize: structure.epitope.patchSize,
          center: structure.epitope.center,
          note: `SASA scan at ${params.probe} Å probe`,
        };
      }
      case 'rfdiffusion':
      case 'proteina': {
        const structure = this.structureFor(node);
        const n = structure.vhh.residues.length;
        const cdr = structure.vhh.regions;
        return {
          kind: 'backbone',
          label: `${n} aa VHH scaffold`,
          structure,
          length: n,
          cdr: cdr.map((r) => `${r.name}:${r.count}`).join(' · '),
          seed: this.project.seed,
          note: `${m.id === 'rfdiffusion' ? `${params.steps} diffusion steps` : `${params.steps} flow steps`} · ${params.length} aa requested`,
        };
      }
      case 'proteinmpnn':
      case 'antifold': {
        const backbone = this.getInput(node, 'backbone');
        const structure = backbone?.structure || this.baseStructure();
        const designs = makeDesigns(structure, this.project, {
          modelId: m.id,
          count: Number(params.numSeqs) || 4,
          temperature: Number(params.temperature) || 0.1,
        });
        return {
          kind: 'sequence',
          label: `${designs.length} designed sequences`,
          designs,
          topScore: designs[0]?.score,
          note: `${m.name} · T=${params.temperature}${params.cdrBias != null ? ` · CDR bias ${params.cdrBias}` : ''}`,
        };
      }
      case 'esmfold':
      case 'boltz2': {
        const sequence = this.getInput(node, 'sequence');
        const backbone = this.getInput(node, 'backbone');
        const designs = sequence?.designs || [];
        const structure = backbone?.structure || this.baseStructure();
        const confidence = designs[0]?.metrics?.pLDDT ?? 0;
        return {
          kind: 'complex',
          label: `Complex predicted · pLDDT ${confidence}`,
          structure,
          designs,
          pLDDT: confidence,
          note: m.id === 'esmfold' ? `${params.recycles} recycles` : `${params.samples} diffusion samples${params.affinity ? ' · affinity head' : ''}`,
        };
      }
      case 'dockq': {
        const complex = this.getInput(node, 'complex');
        const designs = complex?.designs || this.getInput(node, 'sequence')?.designs || [];
        const mean = designs.length
          ? designs.reduce((s, d) => s + d.metrics.dockq, 0) / designs.length
          : 0;
        return {
          kind: 'metrics',
          label: `DockQ ${mean.toFixed(2)} mean · ${designs.length} designs`,
          designs,
          meanDockQ: +mean.toFixed(3),
          cutoff: params.cutoff,
          note: `ipSAE weight ${params.weightIpsae}`,
        };
      }
      case 'nanofilter': {
        const sequence = this.getInput(node, 'sequence');
        const designs = sequence?.designs || [];
        return {
          kind: 'profile',
          label: `${designs.length} developability profiles`,
          designs,
          note: 'Humanness · aggregation · PTM liabilities',
        };
      }
      case 'deliver': {
        const sequence = this.getInput(node, 'sequence');
        const metrics = this.getInput(node, 'metrics');
        const profile = this.getInput(node, 'profile');
        const designs = (metrics?.designs || sequence?.designs || []).slice(0, Number(params.topN) || 3);
        return {
          kind: 'deliverable',
          label: `${designs.length} designs · ${params.format}`,
          designs,
          format: params.format,
          metrics: metrics ? metrics.meanDockQ : null,
          profileCount: profile?.designs?.length || 0,
          note: 'FASTA + PDB + metrics.csv + provenance',
        };
      }
      default:
        return { kind: 'unknown', label: m.name };
    }
  }

  statuses(time) {
    const map = new Map();
    for (const node of this.result.nodes) {
      if (!node.model) {
        map.set(node.id, { status: 'error', progress: 0 });
        continue;
      }
      if (time >= node.start + node.duration - EPS) map.set(node.id, { status: 'done', progress: 1 });
      else if (time >= node.start - EPS) map.set(node.id, { status: 'active', progress: Math.max(0, Math.min(1, (time - node.start) / node.duration)) });
      else map.set(node.id, { status: 'pending', progress: 0 });
    }
    return map;
  }

  advance(time) {
    const done = this.result.nodes.filter((n) => n.model && time >= n.start + n.duration - EPS);
    const newly = [];
    for (const node of done) {
      const artifact = this.ensureArtifact(node);
      if (!this.seen.has(node.id)) {
        this.seen.add(node.id);
        newly.push({ node, artifact });
      }
    }
    return newly;
  }

  preview(time) {
    // Compute artifacts for everything already on the timeline.
    this.advance(time);
    const done = this.result.nodes.filter((n) => n.model && time >= n.start + n.duration - EPS);
    let backbone = null;
    let sequence = null;
    let complex = null;
    let metrics = null;
    let profile = null;
    let deliverable = null;
    for (const node of done) {
      const kind = node.model.output;
      if (kind === 'backbone') backbone = node;
      if (kind === 'sequence') sequence = node;
      if (kind === 'complex') complex = node;
      if (kind === 'metrics') metrics = node;
      if (kind === 'profile') profile = node;
      if (kind === 'deliverable') deliverable = node;
    }
    const backboneArtifact = backbone ? this.ensureArtifact(backbone) : null;
    const sequenceArtifact = sequence ? this.ensureArtifact(sequence) : null;
    const complexArtifact = complex ? this.ensureArtifact(complex) : null;
    const metricsArtifact = metrics ? this.ensureArtifact(metrics) : null;
    const profileArtifact = profile ? this.ensureArtifact(profile) : null;
    const deliverableArtifact = deliverable ? this.ensureArtifact(deliverable) : null;
    const structure = backboneArtifact?.structure
      || complexArtifact?.structure
      || this.baseStructure();
    const designs = metricsArtifact?.designs
      || complexArtifact?.designs
      || sequenceArtifact?.designs
      || deliverableArtifact?.designs
      || [];
    const activeNode = this.result.nodes.find((n) => n.model && time >= n.start - EPS && time < n.start + n.duration - EPS) || null;
    const progress = activeNode ? Math.max(0, Math.min(1, (time - activeNode.start) / activeNode.duration)) : 0;
    return {
      time,
      structure,
      hasBackbone: Boolean(backbone),
      hasSequence: Boolean(sequenceArtifact || designs.length),
      hasComplex: Boolean(complexArtifact),
      designs,
      metrics: metricsArtifact,
      profile: profileArtifact,
      deliverable: deliverableArtifact,
      activeNode,
      progress,
      doneIds: new Set(done.map((n) => n.id)),
      stage: this.stageLabel(time, { backbone, sequence, complex, metrics, deliverable, activeNode }),
    };
  }

  stageLabel(time, ctx) {
    if (ctx.activeNode) {
      const m = ctx.activeNode.model;
      if (m.kind === 'backbone') return 'Diffusing VHH scaffold';
      if (m.kind === 'sequence') return 'Designing paratope sequences';
      if (m.kind === 'structure') return 'Folding candidate complex';
      if (m.kind === 'score') return 'Scoring interface & developability';
      if (m.kind === 'epitope') return 'Mapping epitope surface';
      if (m.kind === 'deliver') return 'Packaging design bundle';
      return m.name;
    }
    if (ctx.deliverable) return 'Delivery bundle ready';
    if (ctx.metrics) return 'Candidates scored';
    if (ctx.complex) return 'Complex validated';
    if (ctx.sequence) return 'Sequence designs ready';
    if (ctx.backbone) return 'VHH scaffold generated';
    return 'Target surface';
  }

  results(time = this.project.duration) {
    const preview = this.preview(time);
    return preview.designs.map((d) => ({
      ...d,
      structure: preview.structure,
      deliverable: Boolean(preview.deliverable),
    }));
  }

  exportPayload(time = this.project.duration) {
    const preview = this.preview(time);
    return {
      structure: preview.structure,
      designs: preview.designs,
      time,
      hasBackbone: preview.hasBackbone,
    };
  }
}

export function timelineEnd(project) {
  return projectDuration(project);
}

export function clipStatusLabel(status) {
  return { pending: 'Queued', active: 'Rendering', done: 'Cached', error: 'Error' }[status] || 'Queued';
}

export function modelOf(clip) {
  return MODEL_BY_ID[clip.modelId] || null;
}
