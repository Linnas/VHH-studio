/* Canvas monitor — three synchronized views over the same timeline state:
   3D schematic complex · pipeline flow map · designed sequence. */

import { qs, clamp } from './dom.js';
import { formatTimecode } from '../engine/rng.js';

const REGION_COLORS = {
  cdr1: '#5ee7ff',
  cdr2: '#c8ff4d',
  cdr3: '#ff6fae',
  framework: '#95a7b9',
};
const REGION_LABELS = { cdr1: 'CDR1', cdr2: 'CDR2', cdr3: 'CDR3' };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}
const RGB = Object.fromEntries(Object.entries(REGION_COLORS).map(([k, v]) => [k, hexToRgb(v)]));
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function rgb(reg, a = 1) {
  const { r, g, b } = RGB[reg] || RGB.framework;
  return `rgba(${r},${g},${b},${a})`;
}

function pathRoundRect(ctx, x, y, w, h, r = 6) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

export class Monitor {
  constructor(app) {
    this.app = app;
    this.canvas = qs('#monitorCanvas');
    this.wrap = qs('#monitorWrap');
    this.ctx = this.canvas.getContext('2d');
    this.emptyEl = qs('#monitorEmpty');
    this.legendEl = qs('#monitorLegend');
    this.kickerEl = qs('#monitorKicker');
    this.stageEl = qs('#monitorStage');
    this.pillsEl = qs('#monitorPills');
    this.tcEl = qs('#monitorTc');
    this.liveDot = qs('#liveDot');

    this.camera = { yaw: 0.38, pitch: -0.12, zoom: 1 };
    this.pointer = null;
    this.hover = null;
    this.flowHits = [];
    this.seqHits = [];
    this.lastTs = performance.now();
    this._hudKey = '';
    this.w = 0;
    this.h = 0;

    this.bind();
    this.resize();
    this.app.on('view', () => this.syncMode());
    this.app.on('tick', () => this.syncHud());
    this.app.on('playhead', () => this.syncHud());
    this.app.on('candidate', () => this.syncHud(true));
    this.app.on('project', () => this.syncHud(true));
    this.app.on('results', () => this.syncHud(true));
    this.syncMode();
    this.syncHud(true);
    requestAnimationFrame((ts) => this.loop(ts));
  }

  syncMode() {
    const view = this.app.state.view;
    this.wrap.dataset.view = view;
    this.canvas.style.cursor = view === '3d' ? 'grab' : 'pointer';
    if (view === 'flow' || view === 'sequence') {
      this.emptyEl.classList.add('hidden');
    }
    this.syncHud(true);
  }

  bind() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.wrap);

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.app.state.view === '3d') {
        this.pointer = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: false };
        this.canvas.setPointerCapture?.(e.pointerId);
        this.canvas.style.cursor = 'grabbing';
      } else {
        this.pointer = { mode: 'click', x: e.clientX, y: e.clientY, moved: false };
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.pointer) return;
      const dx = e.clientX - this.pointer.x;
      const dy = e.clientY - this.pointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.pointer.moved = true;
      if (this.pointer.mode === 'orbit') {
        this.camera.yaw += dx * 0.008;
        this.camera.pitch = clamp(this.camera.pitch + dy * 0.006, -1.1, 1.1);
        this.pointer.x = e.clientX;
        this.pointer.y = e.clientY;
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (this.pointer?.mode === 'click' && !this.pointer.moved) this.handleClick(e);
      this.pointer = null;
      this.canvas.style.cursor = this.app.state.view === '3d' ? 'grab' : 'pointer';
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.pointer = null;
      this.canvas.style.cursor = 'grab';
    });
    this.canvas.addEventListener('wheel', (e) => {
      if (this.app.state.view !== '3d') return;
      e.preventDefault();
      this.camera.zoom = clamp(this.camera.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.4);
    }, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.resetCamera());
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (this.app.state.view === 'flow') {
      const hit = this.flowHits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
      if (hit) {
        this.app.state.selectedId = hit.id;
        this.app.state.tab = 'inspector';
        this.app.emit('selection');
        this.app.emit('tab');
      } else {
        this.app.state.selectedId = null;
        this.app.emit('selection');
      }
    } else if (this.app.state.view === 'sequence') {
      const hit = this.seqHits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
      if (hit) this.app.setCandidate(hit.index);
    }
  }

  resetCamera() {
    this.camera = { yaw: 0.38, pitch: -0.12, zoom: 1 };
    this.app.toast('Camera reset');
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.wrap.getBoundingClientRect();
    this.w = Math.max(10, Math.round(rect.width));
    this.h = Math.max(10, Math.round(rect.height));
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  loop(ts) {
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000 || 0.016);
    this.lastTs = ts;
    if (this.app.state.spin && this.app.state.view === '3d' && !this.pointer) {
      this.camera.yaw += dt * 0.28;
    }
    this.draw();
    this.syncHud();
    requestAnimationFrame((next) => this.loop(next));
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const view = this.app.state.view;
    if (view === 'flow') this.drawFlow();
    else if (view === 'sequence') this.drawSequence();
    else this.draw3D();
  }

  /* ================================== 3D =================================== */
  draw3D() {
    const ctx = this.ctx;
    const { w, h } = this;
    const preview = this.app.preview();
    const structure = preview.structure;
    const active = preview.activeNode;
    const diffusing = active?.model?.kind === 'backbone';
    const showVHH = preview.hasBackbone || diffusing;
    const alphaVHH = preview.hasBackbone ? 1 : diffusing ? 0.18 + preview.progress * 0.82 : 0;

    const pts = structure.antigen.points;
    const vhh = structure.vhh.residues;
    let maxR = 34;
    for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x, p.y, p.z));
    for (const r of vhh) maxR = Math.max(maxR, Math.hypot(r.x, r.y, r.z));
    maxR += 4;
    const scale = (Math.min(w, h) * 0.6 / maxR) * this.camera.zoom;
    const cx = w / 2;
    const cy = h * 0.5 + 6;

    const project = (p) => {
      const cyaw = Math.cos(this.camera.yaw), syaw = Math.sin(this.camera.yaw);
      const cp = Math.cos(this.camera.pitch), sp = Math.sin(this.camera.pitch);
      let x = p.x * cyaw - p.z * syaw;
      let z = p.x * syaw + p.z * cyaw;
      const y = p.y * cp - z * sp;
      z = p.y * sp + z * cp;
      const persp = 1 + z / (maxR * 5.2);
      return {
        x: cx + x * scale * persp,
        y: cy - y * scale * persp,
        z,
        s: scale * persp,
        depth: clamp((z + maxR) / (maxR * 2), 0, 1),
      };
    };

    // Ambient glow behind the target.
    const surfaceCenter = project({ x: 0, y: 0, z: 0 });
    const glowR = maxR * scale * 0.95;
    const glow = ctx.createRadialGradient(surfaceCenter.x, surfaceCenter.y, glowR * 0.06, surfaceCenter.x, surfaceCenter.y, glowR);
    glow.addColorStop(0, 'rgba(66,108,138,0.26)');
    glow.addColorStop(0.5, 'rgba(40,68,88,0.11)');
    glow.addColorStop(1, 'rgba(6,8,11,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Surface mesh.
    ctx.lineWidth = 0.65;
    for (const [i, j] of structure.antigen.edges) {
      const a = project(pts[i]);
      const b = project(pts[j]);
      const d = (a.depth + b.depth) / 2;
      ctx.strokeStyle = `rgba(92,122,148,${0.035 + d * 0.085})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Surface atoms, far → near.
    const sorted = pts.map((p) => ({ p, q: project(p) })).sort((a, b) => a.q.z - b.q.z);
    for (const { p, q } of sorted) {
      const depth = q.depth;
      const r = Math.max(1.1, (1.15 + (p.size - 1.5) * 0.9) * (0.72 + depth * 0.55) * Math.sqrt(scale / 5));
      if (p.epitope) {
        ctx.fillStyle = `rgba(255,180,84,${0.05 + depth * 0.08})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,194,116,${0.42 + depth * 0.5})`;
      } else {
        ctx.fillStyle = `rgba(104,134,160,${0.18 + depth * 0.55})`;
      }
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pulsing epitope ring before a scaffold exists.
    if (!showVHH) {
      const c = project(structure.epitope.center);
      const pulse = (Math.sin(performance.now() * 0.0022) + 1) / 2;
      ctx.strokeStyle = `rgba(255,180,84,${0.16 + pulse * 0.16})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 26 + pulse * 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Hotspot labels.
    if (this.app.state.labels) this.drawHotspots(structure, project, showVHH);

    if (showVHH) this.drawVHH(preview, project, { diffusing, alpha: alphaVHH, structure });

    // Contact annotation.
    if (preview.hasBackbone && this.app.state.labels) this.drawContact(structure, project);
  }

  drawHotspots(structure, project, showVHH = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '8px "JetBrains Mono", Consolas, monospace';
    const center = project(structure.epitope.center);
    const vhhPoints = showVHH ? structure.vhh.residues.map(project) : [];
    for (const p of structure.antigen.points) {
      if (!p.hotspot) continue;
      const q = project(p);
      if (q.depth < 0.28) continue;
      if (vhhPoints.some((v) => Math.hypot(v.x - q.x, v.y - q.y) < 26)) continue;
      let dx = q.x - center.x;
      let dy = q.y - center.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const lx = q.x + dx * 24;
      const ly = q.y + dy * 20;
      const label = p.hotspot;
      const tw = ctx.measureText(label).width;
      ctx.strokeStyle = 'rgba(255,180,84,0.28)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.fillStyle = 'rgba(9,13,18,0.82)';
      pathRoundRect(ctx, lx - 3, ly - 8, tw + 6, 13, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,180,84,0.25)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,201,132,0.92)';
      ctx.fillText(label, lx, ly + 2);
    }
    ctx.restore();
  }

  drawVHH(preview, project, { diffusing, alpha, structure }) {
    const ctx = this.ctx;
    const residues = structure.vhh.residues;
    if (!residues?.length) return;
    const time = performance.now() / 1000;
    const noise = diffusing ? (1 - preview.progress) * 9 : 0;
    const origin = structure.vhh.origin || { x: 0, y: 0, z: 0 };
    const vhhScale = 1.13;
    const jittered = residues.map((r, i) => {
      const base = {
        ...r,
        x: origin.x + (r.x - origin.x) * vhhScale,
        y: origin.y + (r.y - origin.y) * vhhScale,
        z: origin.z + (r.z - origin.z) * vhhScale,
      };
      if (!noise) return base;
      const a = i * 1.7 + time * 2.4;
      const b = i * 2.3 + time * 1.9;
      return {
        ...base,
        x: base.x + Math.sin(a) * noise * (0.4 + (i % 5) / 6),
        y: base.y + Math.cos(b) * noise * 0.7,
        z: base.z + Math.sin(a + b) * noise * 0.6,
      };
    });
    const projected = jittered.map((r) => ({ r, q: project(r) }));
    const segments = [];
    for (let i = 0; i < projected.length - 1; i++) {
      const a = projected[i];
      const b = projected[i + 1];
      if (a.r.region !== b.r.region && (a.r.region === 'framework' || b.r.region === 'framework')) {
        // still connect; color follows the non-framework side for a crisp junction
      }
      const region = a.r.region !== 'framework' ? a.r.region : b.r.region;
      segments.push({ a, b, region, z: (a.q.z + b.q.z) / 2, index: i });
    }
    segments.sort((x, y) => x.z - y.z);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Soft underlay to lift the domain off the target.
    ctx.strokeStyle = `rgba(4,7,10,${0.26 * alpha})`;
    ctx.lineWidth = clamp(projected[0].q.s * 0.19, 4.5, 9);
    ctx.beginPath();
    projected.forEach(({ q }, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();

    for (const seg of segments) {
      const isStrand = seg.a.r.ss === 'strand' && seg.b.r.ss === 'strand';
      const width = seg.region === 'cdr3' ? 4.9 : seg.region === 'framework' ? (isStrand ? 5.3 : 2.4) : 4.5;
      const q = seg.a.q;
      const depthA = 0.55 + q.depth * 0.45;
      const color = seg.region === 'framework'
        ? (isStrand
          ? `rgba(190,207,226,${(0.82 + (seg.index % 3) * 0.05) * alpha * depthA})`
          : `rgba(112,132,152,${(0.42 + (seg.index % 2) * 0.08) * alpha * depthA})`)
        : rgb(seg.region, 0.94 * alpha * depthA);
      if (seg.region === 'cdr3') {
        ctx.strokeStyle = rgb('cdr3', 0.12 * alpha);
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(seg.a.q.x, seg.a.q.y);
        ctx.lineTo(seg.b.q.x, seg.b.q.y);
        ctx.stroke();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(seg.b.q.x, seg.b.q.y);
      ctx.stroke();
    }

    // Backbone nodes for texture.
    for (const { r, q } of projected) {
      if (r.region === 'framework') continue;
      ctx.fillStyle = rgb(r.region, 0.55 * alpha);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.app.state.labels && !diffusing) {
      // Stack CDR callouts to the right of the domain so they never collide.
      const centroids = structure.vhh.regions.map((region) => {
        const members = projected.filter((p) => p.r.region === region.key);
        if (!members.length) return null;
        return {
          region,
          x: members.reduce((s, p) => s + p.q.x, 0) / members.length,
          y: members.reduce((s, p) => s + p.q.y, 0) / members.length,
        };
      }).filter(Boolean);
      if (centroids.length) {
        const maxX = Math.max(...centroids.map((c) => c.x));
        const minY = Math.min(...centroids.map((c) => c.y));
        const side = maxX + 66 < this.w - 10 ? 1 : -1;
        const labelX = side > 0 ? Math.min(this.w - 58, maxX + 74) : Math.max(64, Math.min(...centroids.map((c) => c.x)) - 74);
        let labelY = Math.max(46, minY - 4);
        for (const c of centroids) {
          ctx.strokeStyle = rgba(REGION_COLORS[c.region.key], 0.26);
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(labelX + (side > 0 ? -18 : 18), labelY);
          ctx.stroke();
          this.drawTag(labelX, labelY, `${c.region.name} · ${c.region.count}`, REGION_COLORS[c.region.key]);
          labelY += 17;
        }
      }
    }

    // Diffusion noise cloud.
    if (diffusing) {
      const center = residues.reduce((acc, r) => ({ x: acc.x + r.x / residues.length, y: acc.y + r.y / residues.length, z: acc.z + r.z / residues.length }), { x: 0, y: 0, z: 0 });
      const qc = project(center);
      const spread = maxSpread(residues) * (1 - preview.progress) * 1.5 + 5;
      const count = 54;
      for (let i = 0; i < count; i++) {
        const a = i * 2.399 + time * 1.4;
        const rr = spread * (0.35 + ((i * 37) % 100) / 100) * qc.s * 0.35;
        const x = qc.x + Math.cos(a) * rr;
        const y = qc.y + Math.sin(a * 1.3) * rr * 0.8;
        ctx.fillStyle = i % 3 === 0 ? 'rgba(255,180,84,0.38)' : 'rgba(94,231,255,0.34)';
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawTag(x, y, text, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '7.5px "JetBrains Mono", Consolas, monospace';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(8,12,17,0.8)';
    pathRoundRect(ctx, x - tw / 2 - 4, y - 8, tw + 8, 14, 4);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.35);
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fillText(text, x - tw / 2, y + 2);
    ctx.restore();
  }

  drawContact(structure, project) {
    const contact = structure.contacts?.[0];
    if (!contact) return;
    const ctx = this.ctx;
    const a = project(contact.from);
    const b = project(contact.to);
    ctx.save();
    ctx.strokeStyle = 'rgba(233,239,247,0.28)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const q of [a, b]) {
      ctx.fillStyle = 'rgba(233,239,247,0.7)';
      ctx.beginPath();
      ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.app.state.labels) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.font = '7px "JetBrains Mono", Consolas, monospace';
      const label = `${contact.distance.toFixed(1)} Å`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(8,12,17,0.7)';
      pathRoundRect(ctx, mx - tw / 2 - 3, my - 12, tw + 6, 11, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,220,235,0.7)';
      ctx.fillText(label, mx - tw / 2, my - 4);
    }
    ctx.restore();
  }

  /* ================================ FLOW ================================== */
  drawFlow() {
    const ctx = this.ctx;
    const { w, h } = this;
    const nodes = this.app.compile.nodes.filter((n) => n.model);
    const edges = this.app.compile.edges;
    const tracks = ['target', 'epitope', 'backbone', 'sequence', 'validate', 'deliver'];
    const padL = 56, padT = 46, padB = 16;
    const trackH = (h - padT - padB) / tracks.length;
    const cardH = Math.min(52, trackH - 12);
    const cardW = clamp((w - padL - 34) / 5.6, 128, 158);

    ctx.save();
    ctx.font = '8px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(93,107,124,0.85)';
    ctx.fillText('PIPELINE GRAPH', 16, 20);
    ctx.fillStyle = 'rgba(70,84,100,0.8)';
    ctx.fillText(`${nodes.length} NODES · ${edges.length} EDGES · AUTO-WIRED`, 16, 32);

    // Track lanes.
    tracks.forEach((track, i) => {
      const y = padT + i * trackH;
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y + trackH - 1);
      ctx.lineTo(w - 10, y + trackH - 1);
      ctx.stroke();
      const meta = { target: ['TARGET', '#8fa2b8'], epitope: ['EPITOPE', '#ffb454'], backbone: ['BACKBONE', '#c8ff4d'], sequence: ['SEQUENCE', '#5ee7ff'], validate: ['VALIDATE', '#a78bfa'], deliver: ['DELIVER', '#ff6fae'] }[track];
      ctx.fillStyle = 'rgba(93,107,124,0.55)';
      ctx.font = '7px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(meta[0], 14, y + trackH / 2 + 2);
      ctx.fillStyle = rgba(meta[1], 0.5);
      ctx.beginPath();
      ctx.arc(8, y + trackH / 2 - 2, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Timeline x-position, packed per lane so cards never overlap.
    const pos = new Map();
    const timeSpan = Math.max(1, this.app.project.duration);
    for (let t = 0; t < tracks.length; t++) {
      const laneNodes = nodes.filter((n) => n.track === tracks[t]).sort((a, b) => a.start - b.start);
      if (!laneNodes.length) continue;
      const y = padT + t * trackH + (trackH - cardH) / 2;
      let lastRight = -Infinity;
      const placed = [];
      for (const node of laneNodes) {
        const desired = padL + (node.start / timeSpan) * (w - padL - 24);
        const x = Math.max(desired, lastRight + 14);
        placed.push({ id: node.id, x });
        lastRight = x + cardW;
      }
      const overflow = Math.max(0, lastRight - (w - 12));
      const minX = Math.min(...placed.map((p) => p.x));
      const shift = Math.min(overflow, Math.max(0, minX - padL));
      for (const p of placed) pos.set(p.id, { x: p.x - shift, y, w: cardW, h: cardH });
    }

    // Edges.
    for (const edge of edges) {
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      if (!a || !b) continue;
      const color = { backbone: '#c8ff4d', epitope: '#ffb454', target: '#8fa2b8', sequence: '#5ee7ff', complex: '#a78bfa', metrics: '#ff9ec7', profile: '#6ee7a8', deliverable: '#ff6fae' }[edge.type] || '#5d6b7c';
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x;
      const y2 = b.y + b.h / 2;
      const c = Math.max(26, Math.abs(x2 - x1) * 0.45);
      ctx.strokeStyle = rgba(color, 0.36);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + c, y1, x2 - c, y2, x2 - 1, y2);
      ctx.stroke();
      // Arrow.
      ctx.fillStyle = rgba(color, 0.55);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 5, y2 - 2.6);
      ctx.lineTo(x2 - 5, y2 + 2.6);
      ctx.closePath();
      ctx.fill();
    }

    // Cards.
    this.flowHits = [];
    for (const node of nodes) {
      const p = pos.get(node.id);
      if (!p) continue;
      const status = this.app.statusFor(node.id);
      const selected = this.app.state.selectedId === node.id;
      const missing = !node.inputsReady;
      ctx.save();
      // glow for active
      if (status.status === 'active') {
        ctx.shadowColor = rgba(node.model.color, 0.45);
        ctx.shadowBlur = 18;
      }
      ctx.fillStyle = selected ? 'rgba(22,31,40,0.98)' : 'rgba(13,19,26,0.95)';
      pathRoundRect(ctx, p.x, p.y, p.w, p.h, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = selected ? rgba(node.model.color, 0.9) : missing ? 'rgba(255,107,107,0.5)' : 'rgba(38,51,66,0.9)';
      ctx.lineWidth = selected ? 1.4 : 1;
      ctx.stroke();
      // left color bar
      ctx.fillStyle = rgba(node.model.color, 0.9);
      pathRoundRect(ctx, p.x, p.y + 7, 2.5, p.h - 14, 2);
      ctx.fill();
      // status dot
      ctx.fillStyle = status.status === 'done' ? '#6ee7a8' : status.status === 'active' ? '#ffb454' : 'rgba(93,107,124,0.6)';
      ctx.beginPath();
      ctx.arc(p.x + p.w - 8, p.y + 8, 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = selected ? '#ffffff' : '#dbe4ee';
      ctx.font = '600 9.5px Inter, "Segoe UI", sans-serif';
      ctx.fillText(truncate(ctx, node.model.name, p.w - 18), p.x + 9, p.y + 16);
      ctx.fillStyle = 'rgba(139,154,172,0.85)';
      ctx.font = '7px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(truncate(ctx, node.summary || node.model.kindLabel, p.w - 16), p.x + 9, p.y + 27);
      ctx.fillStyle = 'rgba(70,84,100,0.9)';
      ctx.fillText(`${node.start.toFixed(1)}s`, p.x + 9, p.y + p.h - 6);
      ctx.fillStyle = rgba(node.model.color, 0.65);
      ctx.font = '6.5px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(node.model.kindLabel, p.x + p.w - 46, p.y + p.h - 6);
      ctx.restore();
      this.flowHits.push({ id: node.id, x: p.x, y: p.y, w: p.w, h: p.h });
    }
    ctx.restore();
  }

  /* =============================== SEQUENCE ================================ */
  drawSequence() {
    const ctx = this.ctx;
    const { w, h } = this;
    const preview = this.app.preview();
    const designs = preview.designs;
    const design = designs[this.app.state.selectedCandidate] || designs[0];
    this.seqHits = [];

    const padX = 22;
    const sideW = w > 780 ? Math.min(258, Math.round(w * 0.26)) : 0;
    const gap = 20;
    const leftW = w - padX * 2 - (sideW ? sideW + gap : 0);

    ctx.fillStyle = 'rgba(94,231,255,0.8)';
    ctx.font = '7.5px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('SEQUENCE VIEW', padX, 20);

    if (!design) {
      ctx.fillStyle = 'rgba(233,239,247,0.95)';
      ctx.font = '600 16px Inter, "Segoe UI", sans-serif';
      ctx.fillText('Awaiting sequence design', padX, 44);
      ctx.fillStyle = 'rgba(139,154,172,0.8)';
      ctx.font = '9px Inter, "Segoe UI", sans-serif';
      ctx.fillText('Play through a SEQUENCE clip (ProteinMPNN or AntiFold) to generate candidates.', padX, 63);
      ctx.fillStyle = 'rgba(70,84,100,0.9)';
      ctx.font = '7.5px "JetBrains Mono", Consolas, monospace';
      ctx.fillText('NO DESIGNS AVAILABLE AT THIS TIMECODE', padX, h - 16);
      return;
    }

    ctx.fillStyle = 'rgba(233,239,247,0.96)';
    ctx.font = '600 16px Inter, "Segoe UI", sans-serif';
    ctx.fillText(`${design.id}`, padX, 43);
    const designNameWidth = ctx.measureText(`${design.id}`).width;
    ctx.fillStyle = 'rgba(93,107,124,0.95)';
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(`· ${design.length} aa · ${design.modelId === 'antifold' ? 'AntiFold' : 'ProteinMPNN'} design`, padX + designNameWidth + 6, 43);
    ctx.font = '600 16px Inter, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(200,255,77,0.95)';
    ctx.textAlign = 'right';
    ctx.fillText(design.score.toFixed(1), padX + leftW, 43);
    ctx.textAlign = 'left';

    // Header metric chips + CDR legend.
    let chipX = padX;
    const chips = [
      ['Loopline', design.score.toFixed(1), '#c8ff4d'],
      ['ipTM', design.metrics.ipTM.toFixed(2), '#5ee7ff'],
      ['DockQ', design.metrics.dockq.toFixed(2), '#ff9ec7'],
      ['pLDDT', design.metrics.pLDDT.toFixed(0), '#a78bfa'],
      ['Humanness', design.metrics.humanness.toFixed(0), '#6ee7a8'],
    ];
    ctx.font = '7px "JetBrains Mono", Consolas, monospace';
    for (const [label, value, color] of chips) {
      const text = `${label} ${value}`;
      const cw = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(10,15,21,0.8)';
      pathRoundRect(ctx, chipX, 52, cw, 15, 3);
      ctx.fill();
      ctx.strokeStyle = rgba(color, 0.22);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = rgba(color, 0.95);
      ctx.fillText(text, chipX + 6, 62.5);
      chipX += cw + 5;
    }

    // CDR chips right-aligned on the left panel.
    let cdrX = padX + leftW;
    ctx.font = '7px "JetBrains Mono", Consolas, monospace';
    for (const region of [...preview.structure.vhh.regions].reverse()) {
      const text = `${region.name} ${region.count}`;
      const cw = ctx.measureText(text).width + 10;
      cdrX -= cw + 4;
      ctx.fillStyle = rgb(region.key, 0.1);
      pathRoundRect(ctx, cdrX, 52, cw, 15, 3);
      ctx.fill();
      ctx.strokeStyle = rgb(region.key, 0.35);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.fillStyle = rgb(region.key, 0.95);
      ctx.fillText(text, cdrX + 5, 62.5);
    }

    // Compose the wrapped lines around a monospace grid.
    ctx.font = '12px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
    const charW = ctx.measureText('W').width;
    const groupGap = 7;
    let cols = 65;
    while (cols > 32 && cols * charW + Math.floor((cols - 1) / 10) * groupGap > leftW - 48) cols -= 5;
    const linesCount = Math.ceil(design.seq.length / cols);
    const lineH = 34;
    const panelX = padX - 8;
    const panelY = 82;
    const panelW = leftW + 16;
    const panelH = linesCount * lineH + 26;
    const seqX = padX + 30;

    ctx.fillStyle = 'rgba(9,14,20,0.62)';
    pathRoundRect(ctx, panelX, panelY, panelW, panelH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(31,43,56,0.75)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const regionForIndex = (i) => {
      const region = preview.structure.vhh.regions.find((r) => i >= r.start && i <= r.end);
      return region?.key || null;
    };

    for (let line = 0; line < linesCount; line++) {
      const start = line * cols;
      const end = Math.min(design.seq.length, start + cols);
      const baseY = panelY + 29 + line * lineH;

      // Region highlight bands.
      for (const region of preview.structure.vhh.regions) {
        const from = Math.max(start, region.start);
        const to = Math.min(end, region.end + 1);
        if (from >= to) continue;
        const colFrom = from - start;
        const colTo = to - start;
        const x1 = seqX + colFrom * charW + Math.floor(colFrom / 10) * groupGap;
        const x2 = seqX + colTo * charW + Math.floor(Math.max(0, colTo - 1) / 10) * groupGap;
        ctx.fillStyle = rgb(region.key, 0.1);
        pathRoundRect(ctx, x1 - 2, baseY - 12, x2 - x1 + 4, 18, 3);
        ctx.fill();
        ctx.fillStyle = rgb(region.key, 0.55);
        ctx.fillRect(x1 - 1, baseY + 7, x2 - x1 + 2, 1.5);
      }

      // Position number.
      ctx.fillStyle = 'rgba(70,84,100,0.95)';
      ctx.font = '7px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(String(start + 1).padStart(3, ' '), padX, baseY);

      // Residues.
      ctx.font = '12px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
      let x = seqX;
      for (let i = start; i < end; i++) {
        const col = i - start;
        if (col > 0 && col % 10 === 0) {
          x += groupGap;
          ctx.fillStyle = 'rgba(70,84,100,0.55)';
          ctx.font = '7px "JetBrains Mono", Consolas, monospace';
          ctx.fillText(String(i + 1), x - 2, panelY + 10);
          ctx.font = '12px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
        }
        const aa = design.seq[i];
        const region = regionForIndex(i);
        let color = '#c3cfdd';
        if ('DE'.includes(aa)) color = '#ff9b9b';
        else if ('KR'.includes(aa)) color = '#7fd3ff';
        else if ('FWY'.includes(aa)) color = '#ffd479';
        else if ('AGPS'.includes(aa)) color = '#8d9bab';
        else if (aa === 'C') color = '#b9a7ff';
        ctx.fillStyle = region ? rgb(region, 0.98) : color;
        ctx.fillText(aa, x, baseY);
        x += charW;
      }
    }

    // CDR architecture strip.
    const archY = panelY + panelH + 34;
    const archX = seqX;
    const archW = leftW - 36;
    ctx.fillStyle = 'rgba(70,84,100,0.9)';
    ctx.font = '7px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('CDR ARCHITECTURE', padX, archY - 12);
    ctx.strokeStyle = 'rgba(45,58,72,0.9)';
    ctx.beginPath();
    ctx.moveTo(archX, archY);
    ctx.lineTo(archX + archW, archY);
    ctx.stroke();
    ctx.font = '6.5px "JetBrains Mono", Consolas, monospace';
    for (const region of preview.structure.vhh.regions) {
      const x1 = archX + (region.start / design.length) * archW;
      const x2 = archX + ((region.end + 1) / design.length) * archW;
      ctx.fillStyle = rgb(region.key, 0.75);
      pathRoundRect(ctx, x1, archY - 4, Math.max(6, x2 - x1), 8, 2);
      ctx.fill();
      ctx.fillStyle = rgb(region.key, 0.9);
      ctx.fillText(`${region.name} ${region.count}`, Math.max(archX, x1), archY + 17);
    }
    ctx.fillStyle = 'rgba(70,84,100,0.6)';
    ctx.fillText('1', archX - 2, archY + 17);
    ctx.textAlign = 'right';
    ctx.fillText(String(design.length), archX + archW, archY + 17);
    ctx.textAlign = 'left';

    // Design dossier: paratope sequences, developability and provenance.
    const dossierY = archY + 46;
    const cardH = Math.min(172, h - dossierY - 42);
    if (cardH > 90) {
      const gapX = 9;
      const cardW = (leftW - gapX * 2) / 3;
      const drawCard = (x, title, accent) => {
        ctx.fillStyle = 'rgba(10,15,21,0.55)';
        pathRoundRect(ctx, x, dossierY, cardW, cardH, 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(31,43,56,0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = rgba(accent, 0.85);
        ctx.font = '6.8px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(title, x + 9, dossierY + 15);
      };

      drawCard(padX, 'PARATOPE LOOPS', '#ff6fae');
      let py = dossierY + 31;
      for (const region of preview.structure.vhh.regions) {
        const seq = design[region.key] || '';
        ctx.fillStyle = rgb(region.key, 0.9);
        ctx.font = '6.5px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(`${region.name} · ${seq.length} aa`, padX + 9, py);
        ctx.fillStyle = 'rgba(203,214,227,0.85)';
        ctx.font = '7.4px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(truncate(ctx, seq, cardW - 18), padX + 9, py + 12);
        py += 31;
      }

      const secondX = padX + cardW + gapX;
      drawCard(secondX, 'DEVELOPABILITY', '#6ee7a8');
      const devRows = [
        ['Humanness', design.metrics.humanness.toFixed(0), design.metrics.humanness / 100],
        ['Aggregation', design.metrics.aggregation.toFixed(2), 1 - design.metrics.aggregation],
        ['Aromaticity', design.metrics.aromatic.toFixed(2), design.metrics.aromatic * 4],
        ['Net charge', `${design.metrics.netCharge > 0 ? '+' : ''}${design.metrics.netCharge}`, clamp((design.metrics.netCharge + 8) / 16, 0, 1)],
      ];
      let dy = dossierY + 32;
      for (const [label, value, ratio] of devRows) {
        ctx.fillStyle = 'rgba(139,154,172,0.8)';
        ctx.font = '7px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(label, secondX + 9, dy);
        ctx.fillStyle = 'rgba(216,226,238,0.9)';
        ctx.textAlign = 'right';
        ctx.fillText(value, secondX + cardW - 9, dy);
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        pathRoundRect(ctx, secondX + 9, dy + 4, cardW - 18, 2.5, 2);
        ctx.fill();
        ctx.fillStyle = '#6ee7a8';
        pathRoundRect(ctx, secondX + 9, dy + 4, Math.max(2, (cardW - 18) * clamp(ratio, 0, 1)), 2.5, 2);
        ctx.fill();
        dy += 27;
      }

      const thirdX = secondX + cardW + gapX;
      drawCard(thirdX, 'PROVENANCE', '#8fa2b8');
      const provRows = [
        ['Seed', String(this.app.project.seed)],
        ['Backbone', 'RFdiffusion · SIM'],
        ['Sequence', 'ProteinMPNN · SIM'],
        ['Scoring', 'DockQ / ipSAE'],
        ['Runtime', 'local · 0 GPU'],
        ['Target', this.app.project.target?.short || 'demo'],
      ];
      let ry = dossierY + 33;
      for (const [label, value] of provRows) {
        ctx.fillStyle = 'rgba(93,107,124,0.85)';
        ctx.font = '7px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(label, thirdX + 9, ry);
        ctx.fillStyle = 'rgba(203,214,227,0.85)';
        ctx.textAlign = 'right';
        ctx.fillText(truncate(ctx, value, cardW - 70), thirdX + cardW - 9, ry);
        ctx.textAlign = 'left';
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.beginPath();
        ctx.moveTo(thirdX + 9, ry + 7);
        ctx.lineTo(thirdX + cardW - 9, ry + 7);
        ctx.stroke();
        ry += 21;
      }
    }

    if (sideW) this.drawCandidatePanel(designs, design, w - padX - sideW, 82, sideW, h);

    ctx.fillStyle = 'rgba(70,84,100,0.9)';
    ctx.font = '7.5px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('SCHEMATIC SEQUENCE · SIMULATED DESIGN · NOT FOR EXPERIMENTAL USE', padX, h - 14);
  }

  drawCandidatePanel(designs, design, x, y, w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(31,43,56,0.8)';
    ctx.beginPath();
    ctx.moveTo(x - 12, 24);
    ctx.lineTo(x - 12, h - 24);
    ctx.stroke();

    ctx.fillStyle = 'rgba(94,231,255,0.72)';
    ctx.font = '7.5px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('DESIGN CANDIDATES', x, 24);
    ctx.fillStyle = 'rgba(70,84,100,0.9)';
    ctx.textAlign = 'right';
    ctx.fillText(`${designs.length} RANKED · CLICK TO LOAD`, x + w, 24);
    ctx.textAlign = 'left';

    const rowH = 52;
    designs.slice(0, 4).forEach((d, i) => {
      const ry = y + i * (rowH + 5);
      const selected = d === design;
      ctx.fillStyle = selected ? 'rgba(200,255,77,0.055)' : 'rgba(12,18,25,0.75)';
      pathRoundRect(ctx, x, ry, w, rowH, 6);
      ctx.fill();
      ctx.strokeStyle = selected ? 'rgba(200,255,77,0.42)' : 'rgba(30,41,53,0.9)';
      ctx.lineWidth = selected ? 1.3 : 1;
      ctx.stroke();
      ctx.fillStyle = selected ? '#c8ff4d' : 'rgba(139,154,172,0.9)';
      ctx.font = '7px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(`#${d.rank}`, x + 9, ry + 15);
      ctx.fillStyle = 'rgba(233,239,247,0.92)';
      ctx.font = '9px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(d.id, x + 30, ry + 15);
      ctx.fillStyle = 'rgba(94,231,255,0.95)';
      ctx.font = '10px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(d.score.toFixed(1), x + w - 9, ry + 15);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(139,154,172,0.7)';
      ctx.font = '6.8px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(`ipTM ${d.metrics.ipTM.toFixed(2)}  DockQ ${d.metrics.dockq.toFixed(2)}`, x + 9, ry + 30);
      ctx.fillText(`pLDDT ${d.metrics.pLDDT.toFixed(0)}  hum ${d.metrics.humanness.toFixed(0)}  agg ${d.metrics.aggregation.toFixed(2)}`, x + 9, ry + 41);
      this.seqHits.push({ index: i, x, y: ry, w, h: rowH });
    });

    let my = y + Math.min(4, designs.length) * (rowH + 5) + 18;
    ctx.fillStyle = 'rgba(70,84,100,0.9)';
    ctx.font = '7px "JetBrains Mono", Consolas, monospace';
    ctx.fillText('SELECTED METRICS · SIM', x, my);
    my += 8;
    const rows = [
      ['ipTM', design.metrics.ipTM.toFixed(2)],
      ['DockQ', design.metrics.dockq.toFixed(2)],
      ['pLDDT', design.metrics.pLDDT.toFixed(1)],
      ['ΔG', `${design.metrics.dg.toFixed(1)} kcal`],
      ['Humanness', `${design.metrics.humanness.toFixed(0)}/100`],
      ['Aggregation', design.metrics.aggregation.toFixed(2)],
      ['CDR3', `${design.cdr3.length} aa`],
    ];
    for (const [k, v] of rows) {
      if (my > h - 32) break;
      ctx.fillStyle = 'rgba(93,107,124,0.85)';
      ctx.font = '7.5px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(k, x + 1, my + 10);
      ctx.fillStyle = 'rgba(216,226,238,0.92)';
      ctx.textAlign = 'right';
      ctx.fillText(v, x + w - 1, my + 10);
      ctx.textAlign = 'left';
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath();
      ctx.moveTo(x + 1, my + 15);
      ctx.lineTo(x + w - 1, my + 15);
      ctx.stroke();
      my += 17;
    }
    ctx.restore();
  }
  /* ================================= HUD ================================== */
  syncHud(force = false) {
    const preview = this.app.preview();
    const active = preview.activeNode;
    const has = preview.hasBackbone;
    const diffusing = active?.model?.kind === 'backbone';
    const kicker = this.app.state.rendering ? 'RENDERING' : this.app.state.playing ? 'LIVE' : has ? 'CACHED' : diffusing ? 'GENERATING' : 'STANDBY';
    const design = preview.designs[this.app.state.selectedCandidate] || preview.designs[0];
    const pills = [];
    pills.push('<span class="mon-pill sim"><span class="pdot" style="--c:#ffb454"></span>SIMULATION</span>');
    if (has) {
      pills.push(`<span class="mon-pill"><span class="pdot" style="--c:#c8ff4d"></span>VHH <b>${preview.structure.vhh.residues.length} aa</b></span>`);
      const cdr3 = preview.structure.vhh.regions.find((r) => r.key === 'cdr3');
      if (cdr3) pills.push(`<span class="mon-pill"><span class="pdot" style="--c:#ff6fae"></span>CDR3 <b>${cdr3.count}</b></span>`);
    } else {
      pills.push(`<span class="mon-pill"><span class="pdot" style="--c:#ffb454"></span>PATCH <b>${preview.structure.epitope.area} Å²</b></span>`);
    }
    if (design) {
      pills.push(`<span class="mon-pill">ipTM <b>${design.metrics.ipTM.toFixed(2)}</b></span>`);
      pills.push(`<span class="mon-pill">DockQ <b>${design.metrics.dockq.toFixed(2)}</b></span>`);
    }
    const pillsKey = pills.join('');
    const key = `${kicker}|${preview.stage}|${pillsKey}|${has}|${this.app.state.view}|${this.app.state.playhead.toFixed(2)}`;
    if (force || key !== this._hudKey) {
      this._hudKey = key;
      this.kickerEl.textContent = kicker;
      this.stageEl.textContent = preview.stage;
      this.pillsEl.innerHTML = pillsKey;
      this.tcEl.textContent = formatTimecode(this.app.state.playhead, this.app.project.fps);
      this.liveDot.classList.toggle('on', has && !this.app.state.playing);
      this.liveDot.classList.toggle('live', this.app.state.playing || diffusing);
      const showEmpty = this.app.state.view === '3d' && !has && !diffusing && !design;
      this.emptyEl.classList.toggle('hidden', !showEmpty);
      this.legendEl.innerHTML = this.legendHTML(has || diffusing);
    }
  }

  legendHTML(has) {
    if (!has) {
      return `
        <span class="leg" style="--c:#6986a0"><i></i>Antigen surface</span>
        <span class="leg" style="--c:#ffb454"><i></i>Epitope patch</span>
        <span class="leg" style="--c:#d8a25f"><i></i>Hotspot labels</span>`;
    }
    return `
      <span class="leg" style="--c:#8ea0b3"><i></i>Framework</span>
      <span class="leg" style="--c:#5ee7ff"><i></i>CDR1</span>
      <span class="leg" style="--c:#c8ff4d"><i></i>CDR2</span>
      <span class="leg" style="--c:#ff6fae"><i></i>CDR3</span>
      <span class="leg" style="--c:#ffb454"><i></i>Epitope</span>`;
  }
}

function maxSpread(residues) {
  const c = residues.reduce((acc, r) => ({ x: acc.x + r.x / residues.length, y: acc.y + r.y / residues.length, z: acc.z + r.z / residues.length }), { x: 0, y: 0, z: 0 });
  return Math.max(...residues.map((r) => Math.hypot(r.x - c.x, r.y - c.y, r.z - c.z)));
}

