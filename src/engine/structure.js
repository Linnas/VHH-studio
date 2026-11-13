/* Procedural, deterministic molecular geometry for the simulation runtime.
   This is a SCHEMATIC preview (CA trace + surface point cloud), not a physical model. */

import { createRng, hashString, clamp } from './rng.js';

const V3 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  norm: (a) => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
  lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
};

const AA_POOLS = {
  framework: 'QVQLQESGGGLVQAGGSLRLSCAASGFTFSSYAMGWFRQAPGKEREFVAAISWSGGSTYYADSVKGRFTISRDNAKNTVYLQMNSLKPEDTAVYYCAAWGQGTQVTVSS',
  cdr1: 'GFTFSSYAWNRDEGK',
  cdr2: 'ISGSGGSTYYADSVKGAWNR',
  cdr3: 'ARGGYYDSSGYWFDPLHKNTRVSEQM',
  linker: 'GGGGS',
};

const AA_WEIGHTS = {
  cdr3: { Y: 5, W: 3, F: 3, G: 4, S: 4, R: 3, D: 3, A: 2, P: 2, T: 2, N: 2, V: 2, L: 2, H: 1, K: 2, E: 1 },
};

const HYDROPHOBIC = new Set('AVILMFWCY');
const POSITIVE = new Set('KRH');
const NEGATIVE = new Set('DE');

function weightedAA(rng, extra = {}) {
  const base = { G: 4, S: 4, A: 3, T: 3, V: 3, L: 3, Y: 3, D: 2, R: 2, N: 2, P: 2, F: 2, E: 1, K: 2, H: 1, W: 1, M: 1, C: 1, I: 2, Q: 2 };
  const weights = { ...base, ...extra };
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [aa, w] of entries) {
    r -= w;
    if (r <= 0) return aa;
  }
  return 'G';
}

function fibSphere(n) {
  const pts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = ga * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

function buildAntigen(rng, target) {
  const radii = { x: 30 + rng.float(-1.5, 1.5), y: 25 + rng.float(-1.5, 1.5), z: 23 + rng.float(-1, 1) };
  const dirs = fibSphere(340);
  const normal = V3.norm({ x: 0.34 + rng.float(-0.05, 0.05), y: 0.3 + rng.float(-0.05, 0.05), z: 0.92 });
  const points = [];
  const epitopeIndices = [];

  dirs.forEach((d, i) => {
    const theta = Math.atan2(d.z, d.x);
    const phi = Math.acos(clamp(d.y, -1, 1));
    const modulation =
      1 +
      0.055 * Math.sin(3 * theta + 0.7) * Math.cos(2.4 * phi) +
      0.032 * Math.sin(6.5 * phi + 1.3) +
      0.022 * Math.cos(8 * theta);
    const k = 1 / Math.sqrt((d.x / radii.x) ** 2 + (d.y / radii.y) ** 2 + (d.z / radii.z) ** 2);
    const r = k * modulation;
    const p = { x: d.x * r, y: d.y * r, z: d.z * r };
    const epitope = V3.dot(d, normal) > 0.855;
    points.push({ ...p, dir: d, epitope, size: 1.5 + rng.float(0, 0.8), id: i });
    if (epitope) epitopeIndices.push(i);
  });

  // Sparse neighbourhood mesh for a surface-like read.
  const edges = [];
  const maxEdge = 8.2;
  for (let i = 0; i < points.length; i++) {
    let made = 0;
    for (let j = i + 1; j < points.length && made < 3; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dz = points[i].z - points[j].z;
      if (dx * dx + dy * dy + dz * dz < maxEdge * maxEdge) {
        edges.push([i, j]);
        made += 1;
      }
    }
  }

  // Map annotated hotspot labels onto evenly spread patch points.
  const patch = epitopeIndices.map((i) => points[i]);
  const center = patch.reduce((acc, p) => V3.add(acc, p), { x: 0, y: 0, z: 0 });
  const c = V3.mul(center, 1 / Math.max(1, patch.length));
  const labels = (target?.hotspots?.length ? target.hotspots : ['R353', 'S356', 'D355', 'K357']).slice(0, 6);
  const sorted = patch.slice().sort((a, b) => {
    const aa = Math.atan2(a.y - c.y, a.x - c.x);
    const bb = Math.atan2(b.y - c.y, b.x - c.x);
    return aa - bb;
  });
  labels.forEach((label, i) => {
    const p = sorted[Math.floor((i + 0.5) * sorted.length / labels.length)];
    if (p) p.hotspot = label;
  });

  const area = Math.round((patch.length / points.length) * 4 * Math.PI * ((radii.x + radii.y + radii.z) / 3) ** 2);

  return {
    points,
    edges,
    normal,
    center: c,
    radii,
    patchSize: patch.length,
    area,
    labels,
  };
}

function serpStr(x, dir, zSheet, count, rng) {
  const pts = [];
  const span = 2.2;
  const start = dir > 0 ? -7.7 : 7.7;
  for (let i = 0; i < count; i++) {
    const y = start + dir * i * span;
    pts.push({
      x: x + rng.float(-0.25, 0.25),
      y,
      z: zSheet + (i % 2 === 0 ? 0.85 : -0.85) + rng.float(-0.12, 0.12),
    });
  }
  return pts;
}

function loopPts(a, b, count, bulge, zBulge, rng) {
  const pts = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const arc = Math.sin(Math.PI * t);
    pts.push({
      x: V3.lerp(a, b, t).x + Math.sin(Math.PI * t * 2) * 0.6 + rng.float(-0.15, 0.15),
      y: V3.lerp(a, b, t).y + arc * bulge,
      z: V3.lerp(a, b, t).z + arc * zBulge + rng.float(-0.2, 0.2),
    });
  }
  return pts;
}

function buildVHH(rng, lengthParam, epitope, targetSeed) {
  const delta = clamp((lengthParam || 118) - 115, -18, 18);
  const cdr1N = clamp(8 + Math.round(delta * 0.12), 5, 11);
  const cdr2N = clamp(8 + Math.round(delta * 0.12), 5, 11);
  const cdr3N = clamp(14 + delta - Math.round(delta * 0.18), 6, 25);

  const residues = [];
  const add = (pt, region, ss = 'loop') => {
    residues.push({ ...pt, region, ss, idx: residues.length });
  };

  const sheets = [
    { xs: [-6.9, -2.3, 2.3, 6.9], z: 3.05 },
    { xs: [6.9, 2.3, -2.3, -6.9], z: -3.05 },
  ];
  const cdrs = [];
  let last = null;

  const connect = (from, to, region, bulgeY, count, zBulge = 0) => {
    const pts = loopPts(from, to, count, bulgeY, zBulge, rng);
    const startIdx = residues.length;
    pts.forEach((pt) => add(pt, region, 'loop'));
    if (region !== 'framework') {
      cdrs.push({ name: region.replace('cdr', 'CDR').toUpperCase(), key: region, start: startIdx, end: residues.length - 1, count });
    }
    return pts[pts.length - 1];
  };

  for (let s = 0; s < 2; s++) {
    const sheet = sheets[s];
    for (let i = 0; i < 4; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const strand = serpStr(sheet.xs[i], dir, sheet.z, 8, rng);
      strand.forEach((pt) => add(pt, 'framework', 'strand'));
      last = strand[strand.length - 1];
      if (i === 3) break;

      const top = dir > 0;
      const nextFirstY = top ? 7.7 : -7.7;
      const next = { x: sheet.xs[i + 1], y: nextFirstY, z: sheet.z + (top ? -0.85 : 0.85) };
      let region = 'framework';
      let bulge = top ? 3.4 : -3.2;
      let count = 4;
      if (top && s === 0 && i === 0) { region = 'cdr1'; count = cdr1N; bulge = 5.2; }
      else if (top && s === 0 && i === 2) { region = 'cdr2'; count = cdr2N; bulge = 5.5; }
      else if (top && s === 1 && i === 2) { region = 'cdr3'; count = cdr3N; bulge = 7.6; }
      else if (!top) { count = 3; }
      connect(last, next, region, bulge, count, top ? 1.1 : -0.8);
    }
    if (s === 0) {
      // Cross-sheet loop at the bottom.
      const next = { x: 6.9, y: -7.7, z: -3.05 + 0.85 };
      connect(last, next, 'framework', -3.6, 5, 0.4);
    }
  }
  // Terminal segment back toward the framework core.
  const terminal = { x: last.x - 1.8, y: last.y + 2.2, z: last.z - 1.4 };
  connect(last, terminal, 'framework', -1.8, 4, 0);

  // Orient the domain: local +Y faces the antigen surface.
  const yAxis = V3.mul(epitope.normal, -1);
  let xAxis = V3.cross({ x: 0, y: 1, z: 0 }, yAxis);
  if (V3.len(xAxis) < 0.1) xAxis = { x: 1, y: 0, z: 0 };
  xAxis = V3.norm(xAxis);
  const zAxis = V3.norm(V3.cross(xAxis, yAxis));
  // Lift the paratope just above the outermost epitope point.
  const patchProjection = Math.max(...epitope.points.map((p) => V3.dot(p, epitope.normal)));
  const centerProjection = V3.dot(epitope.center, epitope.normal);
  const origin = V3.add(epitope.center, V3.mul(epitope.normal, patchProjection - centerProjection + 8.5));

  // A small deterministic tilt keeps different seeds visually distinct.
  const tiltY = 0.22 + (targetSeed % 17) / 90;
  const tiltX = -0.08 + ((targetSeed >> 3) % 11) / 120;
  const cosY = Math.cos(tiltY), sinY = Math.sin(tiltY);
  const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);

  residues.forEach((r) => {
    let lx = r.x * cosY - r.z * sinY;
    let lz = r.x * sinY + r.z * cosY;
    let ly = r.y * cosX - lz * sinX;
    lz = r.y * sinX + lz * cosX;
    r.x = origin.x + xAxis.x * lx + yAxis.x * ly + zAxis.x * lz;
    r.y = origin.y + xAxis.y * lx + yAxis.y * ly + zAxis.y * lz;
    r.z = origin.z + xAxis.z * lx + yAxis.z * ly + zAxis.z * lz;
  });

  const byRegion = {};
  residues.forEach((r) => {
    if (r.region !== 'framework') {
      byRegion[r.region] = byRegion[r.region] || { start: r.idx, end: r.idx, count: 0 };
      byRegion[r.region].end = r.idx;
      byRegion[r.region].count += 1;
    }
  });
  const regions = Object.entries(byRegion).map(([key, v]) => ({
    key,
    name: key === 'cdr1' ? 'CDR1' : key === 'cdr2' ? 'CDR2' : 'CDR3',
    ...v,
  }));

  return { residues, regions, cdrCounts: { cdr1: cdr1N, cdr2: cdr2N, cdr3: cdr3N }, origin };
}

function computeContacts(structure) {
  const cdr3 = structure.vhh.regions.find((r) => r.key === 'cdr3');
  const tipResidues = cdr3
    ? structure.vhh.residues.filter((r) => r.idx >= cdr3.start && r.idx <= cdr3.end)
    : structure.vhh.residues.slice(-12);
  const patch = structure.antigen.points.filter((p) => p.epitope);
  let best = null;
  for (const v of tipResidues) {
    for (const a of patch) {
      const d = (v.x - a.x) ** 2 + (v.y - a.y) ** 2 + (v.z - a.z) ** 2;
      if (!best || d < best.d) best = { d, v, a };
    }
  }
  return best ? [{ from: best.v, to: best.a, distance: Math.sqrt(best.d) }] : [];
}

export function buildComplex(project, backboneClip) {
  const seed = (project.seed || 1) + hashString(project.target?.id || 'target');
  const rng = createRng(seed);
  const antigen = buildAntigen(rng, project.target);
  const length = backboneClip?.params?.length || 118;
  const vhh = buildVHH(rng, length, antigen, seed);
  const structure = {
    seed,
    antigen,
    vhh,
    epitope: {
      center: antigen.center,
      normal: antigen.normal,
      area: antigen.area,
      labels: antigen.labels,
      patchSize: antigen.patchSize,
    },
    contacts: [],
    targetName: project.target?.name || 'Demo target',
  };
  structure.contacts = computeContacts(structure);
  return structure;
}

export function annotateStructure(structure, design) {
  if (!design) return structure;
  const seq = design.seq || '';
  structure.vhh.residues.forEach((r) => {
    r.aa = seq[r.idx] || 'G';
  });
  return structure;
}

export function makeDesigns(structure, project, opts = {}) {
  const modelId = opts.modelId || 'proteinmpnn';
  const count = clamp(opts.count || 4, 1, 12);
  const temperature = opts.temperature ?? 0.1;
  const baseSeed = (project.seed || 1) + hashString(`${modelId}:${structure.vhh.residues.length}:${temperature}`);
  const designs = [];

  for (let i = 0; i < count; i++) {
    const rng = createRng(baseSeed + i * 7919);
    const framework = AA_POOLS.framework;
    const seq = [];
    for (let pos = 0; pos < structure.vhh.residues.length; pos++) {
      seq.push(framework[(pos + i * 3) % framework.length]);
    }
    const cdrStrings = {};
    for (const region of structure.vhh.regions) {
      const len = region.end - region.start + 1;
      let letters = '';
      for (let j = 0; j < len; j++) {
        const pool = region.key === 'cdr3' ? 'cdr3' : region.key;
        const extra = region.key === 'cdr3' ? AA_WEIGHTS.cdr3 : {};
        if (rng.chance(0.35)) letters += AA_POOLS[pool][Math.floor(rng.next() * AA_POOLS[pool].length)];
        else letters += weightedAA(rng, extra);
      }
      cdrStrings[region.key] = letters;
      for (let j = 0; j < len; j++) seq[region.start + j] = letters[j];
    }

    const r = createRng(baseSeed + i * 104729 + 13);
    const ipTM = 0.7 + r.float(0, 0.2);
    const pLDDT = 78 + r.float(0, 16);
    const dockq = 0.4 + r.float(0, 0.36);
    const dg = -(8 + r.float(0, 6.2));
    const humanness = 81 + r.float(0, 14);
    const aggregation = 0.07 + r.float(0, 0.32);
    const contacts = 13 + Math.floor(r.float(0, 22));
    const hBonds = 3 + Math.floor(r.float(0, 11));
    const shape = 0.52 + r.float(0, 0.26);
    const seqStr = seq.join('');
    const aromatic = [...seqStr].filter((a) => 'FWY'.includes(a)).length / seqStr.length;
    const netCharge = [...seqStr].filter((a) => POSITIVE.has(a)).length - [...seqStr].filter((a) => NEGATIVE.has(a)).length;
    const hydrophobic = [...seqStr].filter((a) => HYDROPHOBIC.has(a)).length / seqStr.length;
    const score = clamp(
      100 * (0.38 * clamp(dockq / 0.8, 0, 1) + 0.24 * ipTM + 0.14 * (humanness / 100) + 0.12 * (pLDDT / 100) + 0.12 * (1 - aggregation)),
      0,
      100,
    );

    designs.push({
      id: `VHH-${String(i + 1).padStart(2, '0')}`,
      index: i,
      seq: seqStr,
      cdr1: cdrStrings.cdr1 || '',
      cdr2: cdrStrings.cdr2 || '',
      cdr3: cdrStrings.cdr3 || '',
      length: seqStr.length,
      modelId,
      metrics: {
        ipTM: +ipTM.toFixed(3),
        pLDDT: +pLDDT.toFixed(1),
        dockq: +dockq.toFixed(3),
        dg: +dg.toFixed(2),
        humanness: +humanness.toFixed(1),
        aggregation: +aggregation.toFixed(3),
        contacts,
        hBonds,
        shape: +shape.toFixed(3),
        aromatic: +aromatic.toFixed(3),
        netCharge,
        hydrophobic: +hydrophobic.toFixed(3),
      },
      score: +score.toFixed(1),
    });
  }

  designs.sort((a, b) => b.score - a.score);
  designs.forEach((d, i) => { d.rank = i + 1; });
  return designs;
}

export function topDesigns(designs, n = 4) {
  return designs.slice(0, n);
}

export function toPDB(structure, design, project) {
  const lines = [];
  lines.push('REMARK   1 LOOPLINE · VHH DESIGN STUDIO — SIMULATION OUTPUT');
  lines.push('REMARK   1 Schematic CA trace generated by the local simulated adapter.');
  lines.push('REMARK   1 NOT a physical structure prediction. Do not use for experimental work.');
  lines.push(`REMARK   1 Project: ${(project?.name || 'untitled').replace(/\s+/g, ' ')}`);
  lines.push(`REMARK   1 Target: ${structure.targetName}`);
  lines.push(`REMARK   1 Design: ${design?.id || 'n/a'}  Score: ${design?.score ?? 'n/a'}`);
  let serial = 1;
  const fmt = (x) => x.toFixed(3).padStart(8, ' ');
  const atom = (chain, resSeq, resName, p) =>
    `ATOM  ${String(serial++).padStart(5, ' ')}  CA  ${resName.padEnd(3, ' ')} ${chain}${String(resSeq).padStart(4, ' ')}    ${fmt(p.x)}${fmt(p.y)}${fmt(p.z)}  1.00  0.00           C`;

  // Chain A: epitope patch only, so the exported file shows the targeted surface.
  const patch = structure.antigen.points.filter((p) => p.epitope).slice(0, 80);
  patch.forEach((p, i) => {
    lines.push(atom('A', 300 + i, 'GLY', p));
  });
  lines.push('TER');
  structure.vhh.residues.forEach((r, i) => {
    const aa3 = AA3[r.aa] || 'GLY';
    lines.push(atom('B', i + 1, aa3, r));
  });
  lines.push('TER');
  lines.push('END');
  return lines.join('\n') + '\n';
}

const AA3 = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE',
  L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL',
};

export function toFasta(designs, project) {
  const header = (d) => `>${project.name.replace(/\s+/g, '_')}_${d.id} score=${d.score} ipTM=${d.metrics.ipTM} DockQ=${d.metrics.dockq} runtime=simulation`;
  return designs.map((d) => `${header(d)}\n${d.seq.match(/.{1,60}/g).join('\n')}`).join('\n') + '\n';
}

export function toCSV(designs) {
  const cols = ['rank', 'id', 'score', 'length', 'ipTM', 'pLDDT', 'dockq', 'dg', 'humanness', 'aggregation', 'contacts', 'hBonds', 'cdr3'];
  const rows = designs.map((d) => [
    d.rank, d.id, d.score, d.length,
    d.metrics.ipTM, d.metrics.pLDDT, d.metrics.dockq, d.metrics.dg,
    d.metrics.humanness, d.metrics.aggregation, d.metrics.contacts, d.metrics.hBonds,
    `"${d.cdr3}"`,
  ].join(','));
  return `${cols.join(',')}\n${rows.join('\n')}\n`;
}

export { V3 };
