/* NLE-style timeline: drag, trim, scrub, zoom, snap and model drops. */

import { TRACKS, getModel, clipSummary } from '../engine/models.js';
import { hashString, formatClock, formatTimecode, clamp, roundTo } from '../engine/rng.js';
import { icon, escapeHtml, qs, qsa } from './dom.js';

export class Timeline {
  constructor(app) {
    this.app = app;
    this.headsEl = qs('#trackHeads');
    this.scrollEl = qs('#tlScroll');
    this.contentEl = qs('#tlContent');
    this.rulerEl = qs('#ruler');
    this.lanesEl = qs('#lanes');
    this.playheadEl = qs('#playhead');
    this.clipEls = new Map();
    this.laneEls = new Map();
    this.drag = null;
    this.scrubbing = false;
    this.tip = null;
    this.lastStatusKey = '';

    this.renderHeads();
    this.bind();
    this.app.on('project', () => this.renderAll());
    this.app.on('playhead', () => this.updatePlayhead());
    this.app.on('tick', () => this.updateStatuses());
    this.app.on('selection', () => this.updateSelection());
    this.app.on('zoom', () => this.layout());
    window.addEventListener('resize', () => this.layout());

    this.renderAll();
  }

  /* --------------------------------- render --------------------------------- */
  renderHeads() {
    const counts = this.counts();
    this.headsEl.innerHTML = `
      <div class="tl-corner"><span>TRACKS</span><span class="tl-corner-hint">${TRACKS.length}</span></div>
      ${TRACKS.map((t) => `
        <div class="track-head" data-track="${t.id}" style="--c:${t.color}">
          <span class="track-dot"></span>
          <span class="track-info">
            <span class="track-name">${t.name}</span>
            <span class="track-desc">${t.desc}</span>
          </span>
          <span class="track-count ${counts[t.id] ? 'has' : ''}" data-count="${t.id}">${counts[t.id] || 0}</span>
        </div>`).join('')}`;
    this.lanesEl.innerHTML = TRACKS.map((t) => `<div class="lane" data-track="${t.id}"></div>`).join('');
    this.laneEls = new Map(qsa('.lane', this.lanesEl).map((el) => [el.dataset.track, el]));
  }

  counts() {
    const counts = Object.fromEntries(TRACKS.map((t) => [t.id, 0]));
    for (const c of this.app.project.clips) counts[c.track] = (counts[c.track] || 0) + 1;
    return counts;
  }

  renderAll() {
    this.pps = this.app.state.zoom;
    this.renderHeads();
    this.layout({ skipRuler: false });
    this.updateSelection();
  }

  layout() {
    this.pps = this.app.state.zoom;
    const duration = this.app.project.duration;
    const width = Math.max(duration * this.pps + 12, this.scrollEl.clientWidth);
    this.contentEl.style.width = `${width}px`;
    this.contentEl.style.setProperty('--grid', `${Math.max(20, this.pps / 2)}px`);
    this.renderRuler();
    this.renderClips();
    this.updateStatuses();
    this.updatePlayhead(true);
  }

  renderRuler() {
    const pps = this.pps;
    const duration = this.app.project.duration;
    const labelSteps = [0.5, 1, 2, 5, 10, 20, 30, 60];
    const labelStep = labelSteps.find((s) => s * pps >= 66) || 60;
    const minor = labelStep / 2;
    const parts = [];
    for (let t = 0; t <= duration + 0.001; t = +(t + minor).toFixed(3)) {
      const x = t * pps;
      const major = Math.abs(t % labelStep) < 0.001;
      parts.push(`<span class="ruler-tick ${major ? '' : 'minor'}" style="left:${x}px"></span>`);
      if (major) {
        const label = labelStep >= 1 ? `${Math.round(t)}s` : `${t.toFixed(1)}s`;
        parts.push(`<span class="ruler-label" style="left:${x}px">${label}</span>`);
      }
    }
    this.rulerEl.style.width = `${Math.max(duration * pps + 12, this.scrollEl.clientWidth)}px`;
    this.rulerEl.innerHTML = parts.join('');
  }

  sparkPath(id) {
    const h = hashString(id);
    let d = 'M0 6';
    for (let i = 0; i < 23; i++) {
      const x = i * 2;
      const y = 6 + Math.sin((h % 41) / 5 + i * 0.82) * 2.8 + Math.sin(i * 0.3 + (h % 13)) * 1.2;
      d += ` L${x} ${y.toFixed(2)}`;
    }
    return d;
  }

  renderClips() {
    this.clipEls.clear();
    this.lanesEl.innerHTML = '';
    for (const t of TRACKS) {
      const lane = document.createElement('div');
      lane.className = 'lane';
      lane.dataset.track = t.id;
      this.lanesEl.appendChild(lane);
      this.laneEls.set(t.id, lane);
    }
    const byTrack = new Map(TRACKS.map((t) => [t.id, []]));
    for (const clip of this.app.project.clips) {
      const model = getModel(clip.modelId);
      if (!model) continue;
      const lane = this.laneEls.get(clip.track);
      if (!lane) continue;
      const status = this.app.statusFor(clip.id);
      const width = Math.max(22, clip.duration * this.pps - 1);
      const compact = width < 58;
      const el = document.createElement('div');
      el.className = `clip${compact ? ' compact' : ''}`;
      el.dataset.id = clip.id;
      el.dataset.status = status.status;
      el.style.left = `${clip.start * this.pps}px`;
      el.style.width = `${width}px`;
      el.style.setProperty('--clip', model.color);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.title = `${model.name} · ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)} · ${clipSummary(clip)}`;
      el.innerHTML = `
        <span class="clip-stripe"></span>
        <div class="clip-body">
          <div class="clip-top">
            <span class="clip-icon">${icon(model.glyph)}</span>
            <span class="clip-name">${escapeHtml(model.name)}</span>
            <span class="clip-dur">${clip.duration.toFixed(1)}s</span>
          </div>
          <div class="clip-sub">${escapeHtml(clipSummary(clip))}</div>
        </div>
        <svg class="clip-spark" viewBox="0 0 46 12" preserveAspectRatio="none" aria-hidden="true">
          <path d="${this.sparkPath(clip.id)}" fill="none" stroke="${model.color}" stroke-width="0.8" stroke-linecap="round"/>
        </svg>
        <span class="clip-progress" style="width:${status.progress * 100}%"></span>
        <span class="clip-badge">${icon('i-check')}</span>
        <span class="clip-handle" title="Trim duration"></span>`;
      lane.appendChild(el);
      this.clipEls.set(clip.id, el);
      byTrack.get(clip.track)?.push(clip);
    }
    for (const t of TRACKS) {
      const lane = this.laneEls.get(t.id);
      const clips = byTrack.get(t.id) || [];
      if (!clips.length) {
        const hint = document.createElement('span');
        hint.className = 'lane-empty-hint';
        hint.textContent = t.id === 'epitope' ? 'Map the surface patch here' : t.id === 'backbone' ? 'Drop RFdiffusion / PROTEINA here' : `Drop ${t.name.toLowerCase()} models here`;
        lane.appendChild(hint);
      }
    }
  }

  updateStatuses() {
    const key = `${this.app.state.playhead.toFixed(2)}:${this.app.state.selectedId}`;
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    for (const [id, el] of this.clipEls) {
      const status = this.app.statusFor(id);
      el.dataset.status = status.status;
      const bar = el.querySelector('.clip-progress');
      if (bar) bar.style.width = `${status.progress * 100}%`;
    }
  }

  updateSelection() {
    for (const [id, el] of this.clipEls) el.classList.toggle('selected', id === this.app.state.selectedId);
  }

  updatePlayhead(force = false) {
    const x = this.app.state.playhead * this.pps;
    this.playheadEl.style.transform = `translateX(${x}px)`;
    if (this.app.state.playing && !this.scrubbing) this.autoScroll(x);
  }

  autoScroll(x) {
    const viewLeft = this.scrollEl.scrollLeft;
    const viewWidth = this.scrollEl.clientWidth;
    if (x > viewLeft + viewWidth - 90) {
      this.scrollEl.scrollLeft = x - viewWidth * 0.55;
    } else if (x < viewLeft + 18) {
      this.scrollEl.scrollLeft = Math.max(0, x - 50);
    }
  }

  fit() {
    const width = this.scrollEl.clientWidth - 18;
    const pps = clamp(width / Math.max(1, this.app.project.duration), 28, 140);
    this.app.setZoom(pps);
    this.scrollEl.scrollLeft = 0;
  }

  /* -------------------------------- interactions ---------------------------- */
  bind() {
    const ruler = this.rulerEl;

    ruler.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.scrubbing = true;
      this.contentEl.classList.add('scrubbing');
      this.app.pause();
      this.scrubTo(e);
      const move = (ev) => this.scrubTo(ev);
      const up = () => {
        this.scrubbing = false;
        this.contentEl.classList.remove('scrubbing');
        window.removeEventListener('pointermove', move);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    });

    this.lanesEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const clipEl = e.target.closest('.clip');
      if (!clipEl) return;
      e.preventDefault();
      e.stopPropagation();
      const id = clipEl.dataset.id;
      const clip = this.app.clipById(id);
      if (!clip) return;
      if (!this.app.state.rendering) this.app.pause();
      this.app.state.selectedId = id;
      this.app.emit('selection');
      const handle = e.target.closest('.clip-handle');
      if (handle) this.startResize(e, clip, clipEl);
      else this.startMove(e, clip, clipEl);
    });

    // Clicking empty track space scrubs and clears the inspector selection.
    this.lanesEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.clip')) return;
      const lane = e.target.closest('.lane');
      if (!lane) return;
      this.app.state.selectedId = null;
      this.app.emit('selection');
      this.app.pause();
      this.scrubTo(e);
    });

    // Drag & drop from the resource library.
    this.contentEl.addEventListener('dragover', (e) => {
      const modelId = this.app.dragModel;
      if (!modelId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const t = this.timeFromEvent(e);
      const snapped = this.app.snapTime(t);
      this.showDropMarker(snapped);
      const model = getModel(modelId);
      if (model) {
        for (const [track, lane] of this.laneEls) lane.classList.toggle('drop-target', track === model.track);
      }
    });
    this.contentEl.addEventListener('dragleave', (e) => {
      if (this.contentEl.contains(e.relatedTarget)) return;
      this.clearDropMarker();
    });
    this.contentEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const modelId = this.app.dragModel || e.dataTransfer.getData('application/x-loopline-model') || e.dataTransfer.getData('text/plain');
      const t = this.app.snapTime(this.timeFromEvent(e));
      this.clearDropMarker();
      if (!getModel(modelId)) return;
      this.app.addClip(modelId, t);
    });

    document.addEventListener('keydown', (e) => {
      if (this.app.state.selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        e.preventDefault();
        this.app.deleteClip(this.app.state.selectedId);
      }
    });
  }

  timeFromEvent(e) {
    const rect = this.contentEl.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / this.pps, 0, this.app.project.duration);
  }

  scrubTo(e) {
    const rect = this.contentEl.getBoundingClientRect();
    const t = clamp((e.clientX - rect.left) / this.pps, 0, this.app.project.duration);
    this.app.setPlayhead(t, { user: true });
  }

  startMove(e, clip, el) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origStart = clip.start;
    const origTrack = clip.track;
    let moved = false;
    let nextStart = origStart;
    let nextTrack = origTrack;
    el.classList.add('dragging');
    this.drag = { mode: 'move', id: clip.id, startX, startY, moved };
    document.body.classList.add('is-editing');

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      nextStart = this.app.snapTime(origStart + dx / this.pps);
      const laneEl = this.laneAtY(ev.clientY);
      nextTrack = laneEl?.dataset.track || nextTrack;
      el.style.left = `${nextStart * this.pps}px`;
      if (nextTrack !== clip.track) {
        const lane = this.laneEls.get(nextTrack);
        if (lane) lane.appendChild(el);
      }
      el.classList.add('dragging');
      this.showTip(ev.clientX, ev.clientY, `${formatClock(nextStart)} · ${nextTrack.toUpperCase()}`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      el.classList.remove('dragging');
      document.body.classList.remove('is-editing');
      this.hideTip();
      this.drag = null;
      if (moved) this.app.moveClip(clip.id, nextStart, nextTrack);
      else this.updateSelection();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  startResize(e, clip, el) {
    const startX = e.clientX;
    const origDuration = clip.duration;
    let nextDuration = origDuration;
    let moved = false;
    el.classList.add('resizing');
    this.drag = { mode: 'resize', id: clip.id };
    document.body.classList.add('is-editing');

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 2) return;
      moved = true;
      const raw = origDuration + dx / this.pps;
      nextDuration = Math.max(0.5, this.app.state.snap ? roundTo(raw, 0.25) : raw);
      el.style.width = `${Math.max(22, nextDuration * this.pps - 1)}px`;
      el.querySelector('.clip-dur').textContent = `${nextDuration.toFixed(1)}s`;
      this.showTip(ev.clientX, ev.clientY, `${nextDuration.toFixed(2)}s`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      el.classList.remove('resizing');
      document.body.classList.remove('is-editing');
      this.hideTip();
      this.drag = null;
      if (moved) this.app.resizeClip(clip.id, nextDuration);
      else this.updateSelection();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  laneAtY(y) {
    for (const lane of this.laneEls.values()) {
      const rect = lane.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) return lane;
    }
    return null;
  }

  showTip(x, y, text) {
    if (!this.tip) {
      this.tip = document.createElement('div');
      this.tip.className = 'drag-tip';
      document.body.appendChild(this.tip);
    }
    this.tip.textContent = text;
    this.tip.style.left = `${x + 12}px`;
    this.tip.style.top = `${y - 28}px`;
    this.tip.classList.add('show');
  }

  hideTip() {
    this.tip?.classList.remove('show');
  }

  showDropMarker(time) {
    if (!this.dropMarker) {
      this.dropMarker = document.createElement('div');
      this.dropMarker.className = 'drop-marker';
      this.contentEl.appendChild(this.dropMarker);
    }
    this.dropMarker.style.left = `${time * this.pps}px`;
    this.dropMarker.innerHTML = `<span>${formatTimecode(time)}</span>`;
    this.dropMarker.classList.add('show');
  }

  clearDropMarker() {
    this.dropMarker?.classList.remove('show');
    for (const lane of this.laneEls.values()) lane.classList.remove('drop-target');
  }
}
