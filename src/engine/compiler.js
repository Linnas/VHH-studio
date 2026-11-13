/* Timeline → typed DAG compiler.
   Ordering is by clip start time; inputs are wired to the most recent completed
   producer of the required artifact type. */

import { ARTIFACTS, MODEL_BY_ID, TRACKS, clipSummary } from './models.js';

const TRACK_ORDER = Object.fromEntries(TRACKS.map((t, i) => [t.id, i]));
const EPS = 0.02;

export function sortClips(clips) {
  return clips.slice().sort((a, b) => {
    if (Math.abs(a.start - b.start) > 1e-6) return a.start - b.start;
    const ta = TRACK_ORDER[a.track] ?? 0;
    const tb = TRACK_ORDER[b.track] ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function fmt(t) {
  return `${t.toFixed(2).replace(/\.?0+$/, '')}s`;
}

export function compile(project) {
  const errors = [];
  const warnings = [];
  const clips = sortClips(project.clips || []);
  const nodes = [];
  const edges = [];
  const completed = [];

  if (!clips.length) {
    errors.push({ code: 'empty', message: 'Timeline is empty. Drag a model onto a track to start.', clipId: null });
  }

  for (const clip of clips) {
    const model = MODEL_BY_ID[clip.modelId];
    const node = {
      ...clip,
      model,
      label: model ? model.name : clip.modelId,
      summary: model ? clipSummary(clip) : '',
      wiring: [],
      inputsReady: true,
      downstream: [],
    };
    if (!model) {
      errors.push({ code: 'model', message: `Unknown model "${clip.modelId}" on clip ${clip.id}.`, clipId: clip.id });
      nodes.push(node);
      continue;
    }
    if (!Number.isFinite(clip.start) || clip.start < 0) {
      errors.push({ code: 'timing', message: `${model.name} starts before 0s.`, clipId: clip.id });
    }
    if (!Number.isFinite(clip.duration) || clip.duration < 0.5) {
      errors.push({ code: 'duration', message: `${model.name} is shorter than 0.5s.`, clipId: clip.id });
    }

    const available = completed.filter((c) => c.start + c.duration <= clip.start + EPS);
    for (const type of model.inputs || []) {
      if (type === 'target') {
        node.wiring.push({ type, optional: false, producerId: null, producerLabel: 'Project target', kind: 'seed' });
        continue;
      }
      const candidates = available.filter((c) => MODEL_BY_ID[c.modelId]?.output === type);
      const producer = candidates.sort((a, b) => (b.start + b.duration) - (a.start + a.duration))[0];
      if (!producer) {
        node.inputsReady = false;
        errors.push({
          code: 'missing-input',
          clipId: clip.id,
          type,
          message: `${model.name} needs ${ARTIFACTS[type]?.label || type} before ${fmt(clip.start)}.`,
        });
        continue;
      }
      node.wiring.push({
        type,
        optional: false,
        producerId: producer.id,
        producerLabel: MODEL_BY_ID[producer.modelId]?.name || producer.modelId,
        producerStart: producer.start,
        producerEnd: producer.start + producer.duration,
        kind: 'clip',
      });
      edges.push({ from: producer.id, to: clip.id, type });
      const producerNode = nodes.find((n) => n.id === producer.id);
      if (producerNode) producerNode.downstream.push(clip.id);
    }

    for (const type of model.optionalInputs || []) {
      const candidates = available.filter((c) => MODEL_BY_ID[c.modelId]?.output === type);
      const producer = candidates.sort((a, b) => (b.start + b.duration) - (a.start + a.duration))[0];
      if (producer) {
        node.wiring.push({
          type,
          optional: true,
          producerId: producer.id,
          producerLabel: MODEL_BY_ID[producer.modelId]?.name || producer.modelId,
          producerStart: producer.start,
          producerEnd: producer.start + producer.duration,
          kind: 'clip',
        });
        edges.push({ from: producer.id, to: clip.id, type });
        const producerNode = nodes.find((n) => n.id === producer.id);
        if (producerNode) producerNode.downstream.push(clip.id);
      } else {
        node.wiring.push({ type, optional: true, producerId: null, producerLabel: 'Not connected', kind: 'none' });
      }
    }

    if (model.id === 'epitope-scan' && !String(clip.params?.hotspots || '').trim()) {
      errors.push({ code: 'params', message: 'Epitope Scan needs at least one hotspot residue.', clipId: clip.id });
      node.inputsReady = false;
    }
    if ((model.id === 'rfdiffusion' || model.id === 'proteina') && !String(clip.params?.hotspots ?? '').trim() && model.id === 'rfdiffusion') {
      warnings.push({ code: 'hotspots', message: 'RFdiffusion has no explicit hotspots; the full epitope patch will be used.', clipId: clip.id });
    }

    nodes.push(node);
    completed.push(clip);
  }

  // Same-track overlaps make the NLE semantics ambiguous — warn, don't block.
  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      const a = clips[i], b = clips[j];
      if (a.track !== b.track) continue;
      if (b.start < a.start + a.duration - EPS) {
        warnings.push({
          code: 'overlap',
          clipId: b.id,
          message: `${MODEL_BY_ID[b.modelId]?.name || b.modelId} overlaps another clip on the ${b.track.toUpperCase()} track.`,
        });
      }
    }
  }
  for (const clip of clips) {
    if (clip.start + clip.duration > (project.duration || 0) + EPS) {
      warnings.push({ code: 'out-of-range', clipId: clip.id, message: `${MODEL_BY_ID[clip.modelId]?.name || clip.modelId} extends past the timeline end.` });
    }
  }

  const order = nodes.filter((n) => n.model).map((n) => n.id);
  const outputs = {};
  for (const n of nodes) {
    if (n.model) outputs[n.model.output] = n.id;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodes,
    edges,
    order,
    outputs,
    duration: project.duration || 20,
  };
}

export function nodeFor(result, clipId) {
  return result.nodes.find((n) => n.id === clipId) || null;
}

export function diagnosticsFor(result, clipId) {
  return {
    errors: result.errors.filter((e) => e.clipId === clipId),
    warnings: result.warnings.filter((w) => w.clipId === clipId),
  };
}

export function artifactsAvailable(result, time) {
  return result.nodes.filter((n) => n.start + n.duration <= time + EPS);
}
