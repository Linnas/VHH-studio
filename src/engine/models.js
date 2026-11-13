/* Model catalog, tracks, targets and starter templates.
   In the MVP every model resolves through the simulated adapter. */

export const TRACKS = [
  { id: 'target', name: 'TARGET', desc: 'Target intake & prep', color: '#8fa2b8' },
  { id: 'epitope', name: 'EPITOPE', desc: 'Surface & hotspot mapping', color: '#ffb454' },
  { id: 'backbone', name: 'BACKBONE', desc: 'Generative scaffold', color: '#c8ff4d' },
  { id: 'sequence', name: 'SEQUENCE', desc: 'Inverse folding & CDR design', color: '#5ee7ff' },
  { id: 'validate', name: 'VALIDATE', desc: 'Fold, dock & triage', color: '#a78bfa' },
  { id: 'deliver', name: 'DELIVER', desc: 'Bundle & export', color: '#ff6fae' },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

export const ARTIFACTS = {
  target: { label: 'Target surface', color: '#8fa2b8' },
  epitope: { label: 'Epitope selection', color: '#ffb454' },
  backbone: { label: 'VHH backbone', color: '#c8ff4d' },
  sequence: { label: 'Sequence designs', color: '#5ee7ff' },
  complex: { label: 'Predicted complex', color: '#a78bfa' },
  metrics: { label: 'Interface metrics', color: '#ff9ec7' },
  profile: { label: 'Developability', color: '#6ee7a8' },
  deliverable: { label: 'Deliverable bundle', color: '#ff6fae' },
};

const p = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

export const MODELS = [
  {
    id: 'target-intake',
    name: 'Target Intake',
    vendor: 'Loopline built-in',
    kind: 'target',
    category: 'prep',
    kindLabel: 'PREP',
    track: 'target',
    color: '#8fa2b8',
    glyph: 'i-doc',
    desc: '载入 PDB / demo 靶点，清理水分子与杂原子，生成可计算的表面表示。',
    inputs: [],
    output: 'target',
    estimate: 'CPU · 2s',
    adapter: 'builtin',
    defaults: { source: 'demo', pdb: 'DEMO-EGFR-D3', clean: true, ph: 7.4 },
    params: [
      p('source', 'Target source', 'select', { options: [['demo', 'Demo surface'], ['pdb', 'PDB ID']] }),
      p('pdb', 'PDB / asset ID', 'text', { hint: 'MVP 使用程序化 demo 表面；接真实解析后此处读取 mmCIF。' }),
      p('clean', 'Remove waters & heteroatoms', 'toggle'),
      p('ph', 'Assumed pH', 'range', { min: 5, max: 9, step: 0.1 }),
    ],
  },
  {
    id: 'epitope-scan',
    name: 'Epitope Scan',
    vendor: 'Loopline built-in',
    kind: 'epitope',
    category: 'map',
    kindLabel: 'MAP',
    track: 'epitope',
    color: '#ffb454',
    glyph: 'i-search',
    desc: 'SASA + 曲率扫描定位可及表面 patch，并把热点残基映射到 3D 表位。',
    inputs: ['target'],
    output: 'epitope',
    estimate: 'CPU · 4s',
    adapter: 'builtin',
    defaults: { method: 'sasa', probe: 1.4, minPatch: 220, hotspots: 'R353,S356,D355,K357,T358' },
    params: [
      p('method', 'Scan method', 'select', { options: [['sasa', 'SASA + curvature'], ['patch', 'Hydrophobic patch'], ['manual', 'Manual hotspots']] }),
      p('probe', 'Probe radius', 'range', { min: 1.0, max: 2.4, step: 0.1, unit: 'Å' }),
      p('minPatch', 'Min patch area', 'range', { min: 120, max: 400, step: 10, unit: 'Å²' }),
      p('hotspots', 'Hotspot residues', 'text', { hint: '逗号分隔，例如 R353,S356。会同步到 RFdiffusion。' }),
    ],
  },
  {
    id: 'rfdiffusion',
    name: 'RFdiffusion',
    vendor: 'Baker Lab · IPD',
    kind: 'backbone',
    category: 'generate',
    kindLabel: 'GENERATE',
    track: 'backbone',
    color: '#c8ff4d',
    glyph: 'i-spark',
    desc: 'RoseTTAFold 微调的扩散模型，按表位热点从头生成 VHH 骨架。',
    inputs: ['target', 'epitope'],
    output: 'backbone',
    estimate: 'A100 · 90s',
    adapter: 'sim',
    reference: 'Watson et al., Nature 2023',
    defaults: { length: 118, steps: 50, noise: 0.5, hotspots: 'R353,S356,D355,K357,T358', symmetry: 'none' },
    params: [
      p('length', 'Scaffold length', 'range', { min: 95, max: 135, step: 1, unit: 'aa' }),
      p('steps', 'Diffusion steps', 'range', { min: 15, max: 150, step: 5 }),
      p('noise', 'Noise scale', 'range', { min: 0.1, max: 1, step: 0.05 }),
      p('hotspots', 'Epitope hotspots', 'text'),
      p('symmetry', 'Symmetry', 'select', { options: [['none', 'C1 (asymmetric)'], ['c3', 'C3']] }),
    ],
  },
  {
    id: 'proteina',
    name: 'PROTEINA',
    vendor: 'SNU · Genentech',
    kind: 'backbone',
    category: 'generate',
    kindLabel: 'GENERATE',
    track: 'backbone',
    color: '#9be15d',
    glyph: 'i-layers',
    desc: '基于流匹配的原子级蛋白生成器，用表位原子接触约束骨架形状。',
    inputs: ['target', 'epitope'],
    output: 'backbone',
    estimate: 'A100 · 120s',
    adapter: 'sim',
    reference: 'Kim et al., ICLR 2025',
    defaults: { length: 120, contacts: 4, steps: 100, temperature: 0.8 },
    params: [
      p('length', 'Scaffold length', 'range', { min: 95, max: 140, step: 1, unit: 'aa' }),
      p('contacts', 'Epitope contact atoms', 'range', { min: 2, max: 8, step: 1 }),
      p('steps', 'Flow steps', 'range', { min: 20, max: 200, step: 10 }),
      p('temperature', 'Sampling temperature', 'range', { min: 0.2, max: 1.5, step: 0.05 }),
    ],
  },
  {
    id: 'proteinmpnn',
    name: 'ProteinMPNN',
    vendor: 'Baker Lab',
    kind: 'sequence',
    category: 'design',
    kindLabel: 'DESIGN',
    track: 'sequence',
    color: '#5ee7ff',
    glyph: 'i-flow',
    desc: '在生成骨架上做逆折叠，固定框架并重新设计 CDR 序列。',
    inputs: ['backbone'],
    output: 'sequence',
    estimate: 'L4 · 8s',
    adapter: 'sim',
    reference: 'Dauparas et al., Science 2022',
    defaults: { numSeqs: 4, temperature: 0.1, fixFramework: true, seed: 41 },
    params: [
      p('numSeqs', 'Designs', 'range', { min: 1, max: 12, step: 1 }),
      p('temperature', 'Sampling temperature', 'range', { min: 0.02, max: 0.5, step: 0.01 }),
      p('fixFramework', 'Fix framework residues', 'toggle'),
      p('seed', 'Random seed', 'number'),
    ],
  },
  {
    id: 'antifold',
    name: 'AntiFold',
    vendor: 'Oxford OPIG',
    kind: 'sequence',
    category: 'design',
    kindLabel: 'DESIGN',
    track: 'sequence',
    color: '#4fd1c5',
    glyph: 'i-seq',
    desc: '抗体专用逆折叠模型，在 CDR 区域采样更符合免疫球蛋白分布的序列。',
    inputs: ['backbone', 'epitope'],
    output: 'sequence',
    estimate: 'L4 · 12s',
    adapter: 'sim',
    defaults: { numSeqs: 4, temperature: 0.15, cdrBias: 0.6 },
    params: [
      p('numSeqs', 'Designs', 'range', { min: 1, max: 12, step: 1 }),
      p('temperature', 'Sampling temperature', 'range', { min: 0.02, max: 0.5, step: 0.01 }),
      p('cdrBias', 'CDR redesign bias', 'range', { min: 0, max: 1, step: 0.05 }),
    ],
  },
  {
    id: 'esmfold',
    name: 'ESMFold',
    vendor: 'Meta AI',
    kind: 'structure',
    category: 'validate',
    kindLabel: 'PREDICT',
    track: 'validate',
    color: '#a78bfa',
    glyph: 'i-layers',
    desc: 'ESM-2 驱动的快速单序列回折，检查设计序列能否折叠回目标骨架。',
    inputs: ['sequence'],
    output: 'complex',
    estimate: 'A10G · 20s',
    adapter: 'sim',
    reference: 'Lin et al., Science 2023',
    defaults: { recycles: 3, pae: true },
    params: [
      p('recycles', 'Recycles', 'range', { min: 1, max: 8, step: 1 }),
      p('pae', 'Export PAE matrix', 'toggle'),
    ],
  },
  {
    id: 'boltz2',
    name: 'Boltz-2',
    vendor: 'MIT · Recursion',
    kind: 'structure',
    category: 'validate',
    kindLabel: 'PREDICT',
    track: 'validate',
    color: '#8b7cf6',
    glyph: 'i-spark',
    desc: '开源复合物结构预测，输出界面置信度与可选结合亲和力估计。',
    inputs: ['sequence', 'epitope'],
    output: 'complex',
    estimate: 'A100 · 45s',
    adapter: 'sim',
    defaults: { samples: 3, affinity: false },
    params: [
      p('samples', 'Diffusion samples', 'range', { min: 1, max: 8, step: 1 }),
      p('affinity', 'Estimate binding affinity', 'toggle'),
    ],
  },
  {
    id: 'dockq',
    name: 'DockQ + ipSAE',
    vendor: 'Interface scoring',
    kind: 'score',
    category: 'score',
    kindLabel: 'SCORE',
    track: 'validate',
    color: '#ff9ec7',
    glyph: 'i-check',
    desc: '评估 VHH–抗原界面：DockQ、ipSAE、接触数、形状互补与氢键。',
    inputs: ['complex'],
    output: 'metrics',
    estimate: 'CPU · 6s',
    adapter: 'builtin',
    defaults: { cutoff: 8, weightIpsae: 0.6 },
    params: [
      p('cutoff', 'Interface cutoff', 'range', { min: 4, max: 12, step: 0.5, unit: 'Å' }),
      p('weightIpsae', 'ipSAE weight', 'range', { min: 0, max: 1, step: 0.05 }),
    ],
  },
  {
    id: 'nanofilter',
    name: 'NanoFilter',
    vendor: 'Loopline built-in',
    kind: 'score',
    category: 'score',
    kindLabel: 'SCORE',
    track: 'validate',
    color: '#6ee7a8',
    glyph: 'i-check',
    desc: '纳米抗体可开发性：人源化程度、聚集倾向、PTM 与表达风险。',
    inputs: ['sequence'],
    output: 'profile',
    estimate: 'CPU · 3s',
    adapter: 'builtin',
    defaults: { humanness: true, aggregation: true },
    params: [
      p('humanness', 'Humanness scoring', 'toggle'),
      p('aggregation', 'Aggregation propensity', 'toggle'),
    ],
  },
  {
    id: 'deliver',
    name: 'Deliver',
    vendor: 'Loopline built-in',
    kind: 'deliver',
    category: 'deliver',
    kindLabel: 'DELIVER',
    track: 'deliver',
    color: '#ff6fae',
    glyph: 'i-download',
    desc: '汇总 top-N 设计为 FASTA / PDB / metrics.csv，并写入完整 provenance。',
    inputs: ['sequence'],
    optionalInputs: ['metrics', 'profile'],
    output: 'deliverable',
    estimate: 'CPU · 1s',
    adapter: 'builtin',
    defaults: { topN: 3, format: 'fasta+pdb+csv' },
    params: [
      p('topN', 'Designs in bundle', 'range', { min: 1, max: 6, step: 1 }),
      p('format', 'Bundle format', 'select', { options: [['fasta+pdb+csv', 'FASTA + PDB + CSV'], ['fasta', 'FASTA only'], ['report', 'Report (HTML)']] }),
    ],
  },
];

export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export function getModel(id) {
  return MODEL_BY_ID[id] || null;
}

export const TARGETS = {
  egfr: {
    id: 'egfr',
    name: 'EGFR · domain III',
    short: 'EGFR-D3',
    pdb: 'DEMO-EGFR-D3',
    organism: 'Homo sapiens',
    hotspots: ['R353', 'S356', 'D355', 'K357', 'T358'],
    note: 'Demo surface inspired by the EGFR domain III dimer interface.',
  },
  pdl1: {
    id: 'pdl1',
    name: 'PD-L1 · IgV domain',
    short: 'PD-L1',
    pdb: 'DEMO-PDL1',
    organism: 'Homo sapiens',
    hotspots: ['Y56', 'E58', 'R113', 'M115', 'Y123'],
    note: 'Demo surface inspired by the PD-1 / PD-L1 interface.',
  },
  her2: {
    id: 'her2',
    name: 'HER2 · domain IV',
    short: 'HER2-D4',
    pdb: 'DEMO-HER2',
    organism: 'Homo sapiens',
    hotspots: ['H245', 'R255', 'D265', 'F268'],
    note: 'Demo surface inspired by trastuzumab epitope region.',
  },
  cd3e: {
    id: 'cd3e',
    name: 'CD3ε · extracellular',
    short: 'CD3ε',
    pdb: 'DEMO-CD3E',
    organism: 'Homo sapiens',
    hotspots: ['E24', 'Q28', 'D31', 'K35'],
    note: 'Demo surface for T-cell engager formatting experiments.',
  },
};

let clipSeq = 0;
export function newClipId() {
  clipSeq += 1;
  return `clp_${clipSeq.toString(36).padStart(3, '0')}`;
}

export function makeClip(modelId, start, duration, params = {}) {
  const model = getModel(modelId);
  if (!model) throw new Error(`Unknown model ${modelId}`);
  return {
    id: newClipId(),
    modelId,
    track: model.track,
    start: Number(start),
    duration: Number(duration),
    params: { ...model.defaults, ...params },
    status: 'pending',
  };
}

export function clipSummary(clip) {
  const m = getModel(clip.modelId);
  if (!m) return '';
  const v = clip.params || {};
  switch (m.id) {
    case 'target-intake': return `${v.pdb || 'demo'} · pH ${v.ph}`;
    case 'epitope-scan': return `${String(v.hotspots || '').split(',').filter(Boolean).length} hotspots · ${v.probe} Å probe`;
    case 'rfdiffusion': return `${v.length} aa · ${v.steps} steps`;
    case 'proteina': return `${v.length} aa · ${v.contacts} contacts`;
    case 'proteinmpnn': return `${v.numSeqs} seqs · T=${v.temperature}`;
    case 'antifold': return `${v.numSeqs} seqs · CDR bias ${v.cdrBias}`;
    case 'esmfold': return `${v.recycles} recycles · PAE ${v.pae ? 'on' : 'off'}`;
    case 'boltz2': return `${v.samples} samples${v.affinity ? ' · affinity' : ''}`;
    case 'dockq': return `cutoff ${v.cutoff} Å · ipSAE ${v.weightIpsae}`;
    case 'nanofilter': return `${v.humanness ? 'humanness' : ''}${v.humanness && v.aggregation ? ' · ' : ''}${v.aggregation ? 'aggregation' : ''}`;
    case 'deliver': return `top ${v.topN} · ${v.format}`;
    default: return '';
  }
}

export function clipError(clip) {
  if (!clip || !Number.isFinite(clip.start) || !Number.isFinite(clip.duration)) return 'Invalid timing';
  if (clip.duration < 0.5) return 'Clip is too short';
  if (clip.start < 0) return 'Negative start time';
  return null;
}

let templateSeed = 0;
function buildTemplate(def) {
  templateSeed += 1;
  return {
    ...def,
    id: `${def.id}-${templateSeed}`,
    clips: def.clips.map((c) => makeClip(c[0], c[1], c[2], c[3] || {})),
  };
}

const TEMPLATE_DEFS = [
  {
    id: 'egfr-denovo',
    name: 'De novo VHH · EGFR-D3',
    meta: 'RFdiffusion → MPNN → ESMFold',
    color: '#c8ff4d',
    target: 'egfr',
    projectName: 'EGFR-D3 · de novo VHH',
    seed: 20261112,
    duration: 20,
    clips: [
      ['target-intake', 0, 2],
      ['epitope-scan', 2, 2],
      ['rfdiffusion', 4, 4, { hotspots: 'R353,S356,D355,K357,T358' }],
      ['proteinmpnn', 8, 3],
      ['esmfold', 11, 3],
      ['dockq', 14, 2],
      ['nanofilter', 16, 2],
      ['deliver', 18, 2],
    ],
  },
  {
    id: 'pdl1-proteina',
    name: 'Epitope-lock · PD-L1',
    meta: 'PROTEINA → AntiFold → Boltz-2',
    color: '#9be15d',
    target: 'pdl1',
    projectName: 'PD-L1 · epitope-locked VHH',
    seed: 771204,
    duration: 21,
    clips: [
      ['target-intake', 0, 2, { pdb: 'DEMO-PDL1' }],
      ['epitope-scan', 2, 2.2, { hotspots: 'Y56,E58,R113,M115,Y123' }],
      ['proteina', 4.2, 5, { length: 116, contacts: 6 }],
      ['antifold', 9.2, 3.4, { numSeqs: 5, cdrBias: 0.72 }],
      ['boltz2', 12.6, 3.8],
      ['dockq', 16.4, 2.2],
      ['deliver', 18.8, 2.2],
    ],
  },
  {
    id: 'her2-sprint',
    name: 'CDR sprint · HER2-D4',
    meta: 'RFdiffusion → AntiFold → DockQ',
    color: '#5ee7ff',
    target: 'her2',
    projectName: 'HER2-D4 · CDR sprint',
    seed: 90331,
    duration: 16,
    clips: [
      ['target-intake', 0, 1.8, { pdb: 'DEMO-HER2' }],
      ['epitope-scan', 1.8, 2, { hotspots: 'H245,R255,D265,F268' }],
      ['rfdiffusion', 3.8, 3.4, { length: 114, steps: 35 }],
      ['antifold', 7.2, 3],
      ['esmfold', 10.2, 2.8],
      ['dockq', 13, 1.8],
    ],
  },
];

export function listTemplates() {
  return TEMPLATE_DEFS.map((d) => ({ id: d.id, name: d.name, meta: d.meta, color: d.color, target: d.target, clips: d.clips.length }));
}

export function instantiateTemplate(id) {
  const def = TEMPLATE_DEFS.find((d) => d.id === id);
  if (!def) return null;
  return buildTemplate(def);
}

export function projectDuration(project) {
  const end = project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const current = Number(project.duration) || 0;
  return Math.max(12, Math.ceil(end * 2) / 2, current);
}

export function makeProject(templateId = 'egfr-denovo') {
  const tpl = instantiateTemplate(templateId) || instantiateTemplate('egfr-denovo');
  const target = TARGETS[tpl.target];
  return {
    schema: 'loopline.project/1',
    id: `prj_${Date.now().toString(36)}`,
    name: tpl.projectName,
    seed: tpl.seed,
    fps: 24,
    target: { ...target, hotspots: [...target.hotspots] },
    clips: tpl.clips,
    playhead: 0,
    duration: tpl.duration,
    view: '3d',
    createdAt: new Date().toISOString(),
    runtime: 'simulation',
    version: 1,
  };
}

export function defaultProject() {
  return makeProject('egfr-denovo');
}
