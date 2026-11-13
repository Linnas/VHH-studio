/* Central application state: project, playhead, history, persistence.
   UI modules consume this class and never mutate the project directly. */

import { defaultProject, projectDuration, getModel, TARGETS, makeProject, instantiateTemplate, MODEL_BY_ID } from './engine/models.js';
import { Engine } from './engine/runtime.js';
import { diagnosticsFor } from './engine/compiler.js';
import { formatClock, formatTimecode, clamp, roundTo } from './engine/rng.js';
import { toPDB, toFasta, toCSV } from './engine/structure.js';

const STORAGE_KEY = 'loopline.project.v1';
const UI_KEY = 'loopline.ui.v1';
const EPS = 0.02;

function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schema === 'loopline.project/1' && Array.isArray(parsed.clips)) {
        parsed.duration = projectDuration(parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to restore project', err);
  }
  return defaultProject();
}

function loadUI() {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export class App {
  constructor() {
    this.project = loadProject();
    this.engine = new Engine(this.project);
    const ui = loadUI();
    this.state = {
      selectedId: null,
      view: this.project.view || '3d',
      tab: 'inspector',
      playing: false,
      rendering: false,
      playhead: clamp(this.project.playhead || 0, 0, this.project.duration),
      speed: 1,
      snap: true,
      zoom: clamp(Number(ui.zoom) || 56, 28, 140),
      logs: [],
      logsOpen: false,
      results: [],
      resultsStale: false,
      selectedCandidate: 0,
      spin: Boolean(ui.spin),
      labels: ui.labels !== false,
    };
    this.history = [];
    this.future = [];
    this._gesture = null;
    this._raf = null;
    this._lastTs = 0;
    this._saveTimer = null;
    this._preview = null;
    this._previewKey = '';
    this.revision = 0;
    this.listeners = new Map();
    this.log('Session restored · simulation runtime ready', 'sys');
    this.log(`Project “${this.project.name}” · ${this.project.clips.length} clips · seed ${this.project.seed}`, 'info');
    this.initialiseResults();
  }

  /* ---------------------------------- events --------------------------------- */
  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.listeners.get(type) || []) {
      try { fn(payload); } catch (err) { console.error(`[${type}] listener failed`, err); }
    }
  }

  /* --------------------------------- helpers -------------------------------- */
  get compile() {
    return this.engine.result;
  }

  diagnostics(clipId) {
    return diagnosticsFor(this.compile, clipId);
  }

  selectedClip() {
    return this.project.clips.find((c) => c.id === this.state.selectedId) || null;
  }

  clipById(id) {
    return this.project.clips.find((c) => c.id === id) || null;
  }

  modelFor(clip) {
    return MODEL_BY_ID[clip?.modelId] || null;
  }

  statusFor(clipId) {
    const node = this.compile.nodes.find((n) => n.id === clipId);
    if (!node || !node.model) return { status: 'error', progress: 0 };
    if (this.state.playhead >= node.start + node.duration - EPS) return { status: 'done', progress: 1 };
    if (this.state.playhead >= node.start - EPS) return { status: 'active', progress: clamp((this.state.playhead - node.start) / node.duration, 0, 1) };
    return { status: 'pending', progress: 0 };
  }

  preview() {
    const key = `${this.revision}:${this.state.playhead.toFixed(2)}:${this.state.selectedCandidate}:${this.engine.artifacts.size}`;
    if (this._preview && this._previewKey === key) {
      this._preview.design = this._preview.designs[this.state.selectedCandidate] || this._preview.designs[0] || null;
      return this._preview;
    }
    const preview = this.engine.preview(this.state.playhead);
    preview.design = preview.designs[this.state.selectedCandidate] || preview.designs[0] || null;
    this._preview = preview;
    this._previewKey = key;
    return preview;
  }

  freshPreview() {
    this._preview = null;
    this._previewKey = '';
    return this.preview();
  }

  snapTime(t) {
    if (!this.state.snap) return Math.max(0, Math.round(t * 100) / 100);
    let best = roundTo(t, 0.25);
    const candidates = [this.state.playhead, 0];
    for (const c of this.project.clips) {
      candidates.push(c.start, c.start + c.duration);
    }
    for (const c of candidates) {
      if (Math.abs(c - t) < 0.14) best = c;
    }
    return clamp(best, 0, this.project.duration);
  }

  findFreeStart(track, desired, duration, excludeId = null) {
    const start = Math.max(0, this.snapTime(desired));
    const others = this.project.clips
      .filter((c) => c.track === track && c.id !== excludeId)
      .sort((a, b) => a.start - b.start);
    let s = start;
    let moved = false;
    for (const c of others) {
      if (s < c.start + c.duration - EPS && s + duration > c.start + EPS) {
        s = c.start + c.duration + 0.05;
        moved = true;
      }
    }
    return { start: Math.max(0, s), moved };
  }

  defaultDuration(model) {
    switch (model.kind) {
      case 'target': return 2;
      case 'epitope': return 2;
      case 'backbone': return model.id === 'proteina' ? 5 : 4;
      case 'sequence': return 3;
      case 'structure': return 3;
      case 'score': return 2;
      case 'deliver': return 2;
      default: return 2.5;
    }
  }

  /* -------------------------------- mutations ------------------------------- */
  beginGesture() {
    if (this._gesture) return;
    this._gesture = JSON.stringify(this.project);
  }

  endGesture() {
    if (!this._gesture) return;
    const before = this._gesture;
    this._gesture = null;
    this.afterMutation(before);
  }

  commit(mutator, { history = true } = {}) {
    const before = JSON.stringify(this.project);
    mutator(this.project);
    this.afterMutation(before, history);
  }

  afterMutation(before, history = true) {
    const after = JSON.stringify(this.project);
    if (before === after) {
      this.emit('project');
      return;
    }
    if (history) {
      this.history.push(before);
      if (this.history.length > 60) this.history.shift();
      this.future = [];
    }
    this.revision += 1;
    this.project.duration = projectDuration(this.project);
    this.project.playhead = clamp(this.project.playhead, 0, this.project.duration);
    if (this.state.playhead > this.project.duration) this.state.playhead = this.project.duration;
    this.engine.setProject(this.project);
    this.state.results = [];
    this.state.resultsStale = true;
    this.state.selectedCandidate = 0;
    this._preview = null;
    this._previewKey = '';
    if (!this.project.clips.some((c) => c.id === this.state.selectedId)) this.state.selectedId = null;
    this.log('Timeline changed · downstream render cache invalidated', 'warn');
    this.save();
    this.emit('project');
    this.emit('selection');
    this.emit('playhead');
    this.emit('results');
    this.emit('history');
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.project));
    const prev = this.history.pop();
    this.project = JSON.parse(prev);
    this.restoreProject();
    this.log('Undo', 'sys');
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.project));
    const next = this.future.pop();
    this.project = JSON.parse(next);
    this.restoreProject();
    this.log('Redo', 'sys');
  }

  restoreProject() {
    if (this.state.playhead > this.project.duration) this.state.playhead = this.project.duration;
    if (!this.project.clips.some((c) => c.id === this.state.selectedId)) this.state.selectedId = null;
    this.engine.setProject(this.project);
    this.state.results = [];
    this.state.resultsStale = true;
    this.state.selectedCandidate = 0;
    this.revision += 1;
    this._preview = null;
    this._previewKey = '';
    this.save();
    this.emit('project');
    this.emit('selection');
    this.emit('playhead');
    this.emit('results');
    this.emit('history');
  }

  addClip(modelId, desiredStart, track = null) {
    const model = getModel(modelId);
    if (!model) return null;
    const start = clamp(this.snapTime(desiredStart ?? this.state.playhead), 0, Math.max(this.project.duration, 1));
    const duration = this.defaultDuration(model);
    const targetTrack = track || model.track;
    const { start: freeStart, moved } = this.findFreeStart(targetTrack, start, duration);
    const params = { ...model.defaults };
    if (model.id === 'epitope-scan' || model.id === 'rfdiffusion') {
      params.hotspots = this.project.target.hotspots.join(',');
    }
    const clip = {
      id: `clp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      modelId,
      track: targetTrack,
      start: freeStart,
      duration,
      params,
      status: 'pending',
    };
    this.commit((p) => {
      p.clips.push(clip);
      p.duration = Math.max(p.duration, clip.start + clip.duration + 0.5);
    });
    this.state.selectedId = clip.id;
    this.state.tab = 'inspector';
    this.emit('selection');
    this.emit('tab');
    this.log(`Added ${model.name} at ${formatClock(clip.start)}`, 'info');
    this.toast(`${model.name} added${moved ? ' to the next free slot' : ''}`);
    return clip.id;
  }

  moveClip(id, start, track) {
    const clip = this.clipById(id);
    if (!clip) return;
    const { start: freeStart, moved } = this.findFreeStart(track, start, clip.duration, id);
    this.commit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      c.start = freeStart;
      c.track = track;
      p.duration = Math.max(p.duration, c.start + c.duration + 0.5);
    });
    if (moved) this.toast('Snapped to next free slot on that track', 'warn');
  }

  resizeClip(id, duration) {
    const clip = this.clipById(id);
    if (!clip) return;
    const d = Math.max(0.5, this.state.snap ? roundTo(duration, 0.25) : duration);
    this.commit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) c.duration = d;
      p.duration = Math.max(p.duration, (c?.start || 0) + d + 0.5);
    });
  }

  deleteClip(id) {
    const clip = this.clipById(id);
    if (!clip) return;
    const name = this.modelFor(clip)?.name || clip.modelId;
    this.commit((p) => {
      p.clips = p.clips.filter((c) => c.id !== id);
    });
    if (this.state.selectedId === id) this.state.selectedId = null;
    this.emit('selection');
    this.log(`Removed ${name}`, 'warn');
    this.toast(`${name} removed`);
  }

  duplicateClip(id) {
    const clip = this.clipById(id);
    if (!clip) return;
    const copy = {
      ...clip,
      id: `clp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      params: { ...clip.params },
      start: clip.start + clip.duration + 0.25,
    };
    const { start } = this.findFreeStart(copy.track, copy.start, copy.duration);
    copy.start = start;
    this.commit((p) => {
      p.clips.push(copy);
      p.duration = Math.max(p.duration, copy.start + copy.duration + 0.5);
    });
    this.state.selectedId = copy.id;
    this.emit('selection');
    this.log(`Duplicated ${this.modelFor(clip)?.name || clip.modelId}`, 'info');
    this.toast('Clip duplicated');
  }

  updateParam(id, key, value) {
    this.commit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      c.params[key] = value;
      if (key === 'hotspots' && (c.modelId === 'rfdiffusion' || c.modelId === 'epitope-scan')) {
        p.target.hotspots = String(value).split(',').map((s) => s.trim()).filter(Boolean);
      }
    });
  }

  renameProject(name) {
    const next = name.trim() || 'Untitled VHH program';
    if (next === this.project.name) return;
    this.history.push(JSON.stringify(this.project));
    if (this.history.length > 60) this.history.shift();
    this.future = [];
    this.project.name = next;
    this.project.playhead = this.state.playhead;
    this.save();
    this.emit('project');
    this.emit('history');
  }

  setSeed(seed) {
    const n = Number(seed);
    if (!Number.isFinite(n)) return;
    this.commit((p) => { p.seed = Math.floor(n); });
    this.toast('Seed updated · designs will be re-sampled');
  }

  setTarget(targetId) {
    const target = TARGETS[targetId];
    if (!target) return;
    this.commit((p) => {
      p.target = { ...target, hotspots: [...target.hotspots] };
      for (const clip of p.clips) {
        if (clip.modelId === 'epitope-scan' || clip.modelId === 'rfdiffusion') {
          clip.params.hotspots = target.hotspots.join(',');
        }
      }
    });
    this.toast(`Target switched to ${target.short}`);
  }

  applyTemplate(templateId) {
    const tpl = instantiateTemplate(templateId);
    if (!tpl) return;
    this.beginGesture();
    this.commit((p) => {
      const fresh = makeProject(templateId);
      p.name = fresh.name;
      p.seed = fresh.seed;
      p.target = fresh.target;
      p.clips = fresh.clips;
      p.duration = fresh.duration;
      p.view = p.view || '3d';
    }, { history: false });
    this.endGesture();
    this.state.playhead = 0;
    this.project.playhead = 0;
    this.state.selectedId = null;
    this.state.selectedCandidate = 0;
    this.state.results = [];
    this.state.resultsStale = false;
    this.engine.invalidate();
    this._preview = null;
    this.save();
    this.log(`Template loaded · ${tpl.name}`, 'sys');
    this.toast(`Template loaded · ${tpl.name}`);
    this.emit('selection');
    this.emit('playhead');
    this.emit('results');
  }

  /* -------------------------------- playhead -------------------------------- */
  setPlayhead(t, { user = false } = {}) {
    const next = clamp(t, 0, this.project.duration);
    if (user && this.state.playing) this.pause();
    if (user && this.state.rendering) {
      this.state.rendering = false;
      this._raf = null;
      this.state.playing = false;
      this.emit('render');
      this.emit('transport');
      this.log('Render interrupted · playhead moved', 'warn');
    }
    if (Math.abs(next - this.state.playhead) < 1e-4) return;
    this.state.playhead = next;
    this.project.playhead = next;
    this.emit('playhead');
    this.saveSoon();
  }

  step(frames) {
    this.setPlayhead(this.state.playhead + frames / (this.project.fps || 24), { user: true });
  }

  play() {
    if (this.state.playing) return;
    if (!this.compile.valid) {
      const first = this.compile.errors[0];
      if (first?.clipId) {
        this.state.selectedId = first.clipId;
        this.emit('selection');
      }
      this.state.tab = 'inspector';
      this.emit('tab');
      this.toast(first ? first.message : 'Pipeline has errors', 'err');
      return;
    }
    if (this.state.playhead >= this.project.duration - EPS) this.setPlayhead(0);
    this.state.playing = true;
    this.state.rendering = false;
    this._lastTs = performance.now();
    this.emit('transport');
    this.log('Playback started', 'sys');
    this.loop();
  }

  pause({ silent = false } = {}) {
    if (!this.state.playing) return;
    this.state.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (!silent) this.log('Playback paused', 'sys');
    this.emit('transport');
  }

  togglePlay() {
    if (this.state.rendering) {
      this.cancelRender();
      return;
    }
    if (this.state.playing) this.pause();
    else this.play();
  }

  loop() {
    if (!this.state.playing) return;
    const step = (ts) => {
      if (!this.state.playing) return;
      const dt = Math.min(0.08, (ts - this._lastTs) / 1000 || 0.016);
      this._lastTs = ts;
      const next = Math.min(this.project.duration, this.state.playhead + dt * this.state.speed);
      this.state.playhead = next;
      this.project.playhead = next;
      const newly = this.engine.advance(next);
      for (const item of newly) this.logArtifact(item);
      if (newly.some(({ node }) => ['sequence', 'metrics', 'deliverable', 'complex'].includes(node.model.output))) {
        this.refreshResults(false);
      }
      if (this.state.rendering && next >= this.project.duration - EPS) {
        this.finishRender();
        return;
      }
      if (next >= this.project.duration - EPS) {
        this.state.playing = false;
        this._raf = null;
        this.log('Reached end of timeline', 'sys');
        this.emit('transport');
        this.emit('tick');
        this.emit('playhead');
        return;
      }
      this.emit('tick');
      this.emit('playhead');
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  logArtifact({ node, artifact }) {
    const ms = artifact?.durationMs ?? 0;
    this.log(`${node.model.name} → ${artifact?.label || 'done'} (${ms} ms simulated)`, node.model.kind === 'score' ? 'ok' : 'info');
    if (node.model.output === 'deliverable') this.log('Bundle ready · FASTA / PDB / metrics.csv', 'ok');
  }

  setSpeed(speed) {
    this.state.speed = speed;
    this.emit('speed');
  }

  render() {
    if (this.state.rendering) {
      this.cancelRender();
      return;
    }
    if (!this.compile.valid) {
      const first = this.compile.errors[0];
      if (first?.clipId) this.state.selectedId = first.clipId;
      this.state.tab = 'inspector';
      this.emit('selection');
      this.emit('tab');
      this.toast(first ? first.message : 'Fix pipeline errors before rendering', 'err');
      return;
    }
    this.engine.invalidate();
    this.revision += 1;
    this.state.results = [];
    this.state.resultsStale = true;
    this.state.selectedCandidate = 0;
    this.state.playhead = 0;
    this.project.playhead = 0;
    this.state.logs = [];
    this.log('Render queued · 0 GPU · simulated adapter', 'sys');
    this.log(`Compiled ${this.compile.order.length} clips · ${this.compile.edges.length} typed edges`, 'info');
    this.state.rendering = true;
    this.state.playing = true;
    this.state.speed = 2;
    this.state.tab = 'inspector';
    this._lastTs = performance.now();
    this.emit('render');
    this.emit('transport');
    this.emit('speed');
    this.emit('tab');
    this.emit('playhead');
    this.emit('logs');
    this.loop();
  }

  cancelRender() {
    this.state.rendering = false;
    this.pause({ silent: true });
    this.log('Render cancelled', 'warn');
    this.emit('render');
    this.emit('transport');
    this.toast('Render cancelled', 'warn');
  }

  finishRender() {
    this.state.playing = false;
    this.state.rendering = false;
    this.state.playhead = this.project.duration;
    this.project.playhead = this.project.duration;
    this._raf = null;
    this.engine.advance(this.project.duration);
    this.refreshResults(true);
    this.state.tab = 'results';
    this.state.resultsStale = false;
    this.log(`Render complete · ${this.state.results.length} designs ranked`, 'ok');
    this.emit('render');
    this.emit('transport');
    this.emit('playhead');
    this.emit('results');
    this.emit('tab');
    this.toast(`Render complete · ${this.state.results.length} candidates`);
    this.saveSoon();
  }

  refreshResults(open = false) {
    const results = this.engine.results(this.state.playhead);
    if (results.length) {
      this.state.results = results;
      this.state.resultsStale = false;
      this.state.selectedCandidate = clamp(this.state.selectedCandidate, 0, results.length - 1);
    }
    if (open && !results.length) {
      this.toast('No designs at this point — play through the sequence clip first', 'warn');
    }
    this.emit('results');
  }

  initialiseResults() {
    try {
      if (this.state.playhead > 0) {
        const results = this.engine.results(this.state.playhead);
        if (results.length) {
          this.state.results = results;
          this.state.resultsStale = false;
        }
      }
    } catch (err) {
      console.warn(err);
    }
  }

  setView(view) {
    this.state.view = view;
    this.project.view = view;
    this.emit('view');
    this.saveSoon();
  }

  setTab(tab) {
    this.state.tab = tab;
    if (tab === 'results' && !this.state.results.length) this.refreshResults(false);
    this.emit('tab');
  }

  setCandidate(index) {
    this.state.selectedCandidate = index;
    this._previewKey = '';
    this.emit('candidate');
  }

  setZoom(zoom) {
    this.state.zoom = clamp(Number(zoom) || 56, 28, 140);
    this.saveSoon();
    this.emit('zoom');
  }

  toggleSnap() {
    this.state.snap = !this.state.snap;
    this.emit('snap');
    this.toast(`Snap ${this.state.snap ? 'on' : 'off'}`);
  }

  toggleLogs(force) {
    this.state.logsOpen = force ?? !this.state.logsOpen;
    this.emit('logs');
  }

  toggleSpin() {
    this.state.spin = !this.state.spin;
    this.saveSoon();
    this.emit('view');
  }

  toggleLabels() {
    this.state.labels = !this.state.labels;
    this.saveSoon();
    this.emit('view');
  }

  /* --------------------------------- logging -------------------------------- */
  log(message, level = 'info') {
    this.state.logs.push({ t: formatClock(this.state.playhead), msg: message, level });
    if (this.state.logs.length > 240) this.state.logs.shift();
    this.emit('logs');
  }

  toast(message, kind = 'ok') {
    this.emit('toast', { message, kind, id: Math.random().toString(36).slice(2) });
  }

  /* -------------------------------- persistence ----------------------------- */
  save() {
    try {
      this.project.playhead = this.state.playhead;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
      localStorage.setItem(UI_KEY, JSON.stringify({ zoom: this.state.zoom, spin: this.state.spin, labels: this.state.labels }));
      this.emit('save', 'saved');
    } catch (err) {
      console.warn('Save failed', err);
      this.emit('save', 'error');
    }
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 350);
  }

  /* --------------------------------- export --------------------------------- */
  download(name, content, mime = 'text/plain') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  slug() {
    return (this.project.name || 'loopline').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'loopline';
  }

  export(kind) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'project') {
      const payload = { ...this.project, exportedAt: new Date().toISOString(), runtime: 'simulation' };
      this.download(`${this.slug()}-${stamp}.loopline.json`, JSON.stringify(payload, null, 2), 'application/json');
      this.log('Exported project file', 'ok');
      this.toast('Project exported');
      return;
    }
    const payload = this.engine.exportPayload(this.state.playhead);
    if (!payload.designs.length) {
      this.toast('No designs available — render the sequence clip first', 'warn');
      return;
    }
    if (kind === 'fasta') {
      this.download(`${this.slug()}-${stamp}.fasta`, toFasta(payload.designs, this.project), 'text/plain');
    } else if (kind === 'csv') {
      this.download(`${this.slug()}-${stamp}-metrics.csv`, toCSV(payload.designs), 'text/csv');
    } else if (kind === 'pdb') {
      if (!payload.hasBackbone) {
        this.toast('No backbone at the playhead — play through the backbone clip', 'warn');
        return;
      }
      const design = payload.designs[this.state.selectedCandidate] || payload.designs[0];
      this.download(`${this.slug()}-${design.id}.pdb`, toPDB(payload.structure, design, this.project), 'chemical/x-pdb');
    }
    this.log(`Exported ${kind.toUpperCase()}`, 'ok');
    this.toast(`${kind.toUpperCase()} exported`);
  }

  timecode(seconds = this.state.playhead) {
    return formatTimecode(seconds, this.project.fps || 24);
  }
}
