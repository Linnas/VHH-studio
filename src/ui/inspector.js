/* Inspector: clip parameters, auto-wiring, pipeline diagnostics and results. */

import { TARGETS, getModel, TRACK_BY_ID, ARTIFACTS } from '../engine/models.js';
import { icon, escapeHtml, escapeAttr, qs } from './dom.js';
import { formatClock } from '../engine/rng.js';

const STATUS_COPY = {
  pending: 'Queued',
  active: 'Rendering',
  done: 'Cached',
  error: 'Error',
};

export class Inspector {
  constructor(app) {
    this.app = app;
    this.body = qs('#inspectorBody');
    this.tabs = qs('#inspectorTabs');
    this.resultCount = qs('#resultCount');
    this.bind();
    this.render();
    this.app.on('selection', () => this.render());
    this.app.on('project', () => this.render());
    this.app.on('tab', () => this.render());
    this.app.on('results', () => this.render());
    this.app.on('candidate', () => this.render());
    this.app.on('playhead', () => this.throttledStatus());
  }

  bind() {
    this.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) this.app.setTab(btn.dataset.tab);
    });

    this.body.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (action) {
        const { action: name, id, index } = action.dataset;
        if (name === 'duplicate') this.app.duplicateClip(id);
        if (name === 'delete') this.app.deleteClip(id);
        if (name === 'select-clip') {
          this.app.state.selectedId = id;
          this.app.emit('selection');
        }
        if (name === 'export-fasta') this.app.export('fasta');
        if (name === 'export-csv') this.app.export('csv');
        if (name === 'start-render') this.app.render();
        if (name === 'focus-result') {
          this.app.setCandidate(Number(index));
          this.app.setView('3d');
        }
        return;
      }
      const result = e.target.closest('.result-card');
      if (result) this.app.setCandidate(Number(result.dataset.index));
    });

    this.body.addEventListener('input', (e) => {
      const input = e.target;
      if (input.type !== 'range') return;
      const val = input.parentElement?.querySelector('.val');
      if (val) val.textContent = this.formatRange(input);
    });

    this.body.addEventListener('change', (e) => {
      const input = e.target;
      if (input.dataset.param) {
        const key = input.dataset.param;
        const type = input.dataset.type;
        let value;
        if (type === 'toggle') value = input.checked;
        else if (type === 'range' || type === 'number') value = Number(input.value);
        else value = input.value;
        this.app.updateParam(this.app.state.selectedId, key, value);
      } else if (input.dataset.projectField === 'seed') {
        this.app.setSeed(input.value);
      } else if (input.dataset.projectField === 'target') {
        this.app.setTarget(input.value);
      }
    });
  }

  throttledStatus() {
    if (this._statusTimer) return;
    this._statusTimer = setTimeout(() => {
      this._statusTimer = null;
      const active = document.activeElement;
      if (this.body.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;
      this.render();
    }, 180);
  }

  formatRange(input) {
    const unit = input.dataset.unit || '';
    const v = Number(input.value);
    return `${Number.isInteger(v) ? v : v.toFixed(2)}${unit ? ` ${unit}` : ''}`;
  }

  render() {
    const tab = this.app.state.tab;
    this.resultCount.textContent = String(this.app.state.results.length);
    for (const btn of this.tabs.querySelectorAll('[data-tab]')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    if (tab === 'results') {
      this.body.innerHTML = this.resultsHTML();
      return;
    }
    const clip = this.app.selectedClip();
    this.body.innerHTML = clip ? this.clipHTML(clip) : this.projectHTML();
  }

  /* ------------------------------- clip view -------------------------------- */
  clipHTML(clip) {
    const model = getModel(clip.modelId);
    if (!model) return this.projectHTML();
    const node = this.app.compile.nodes.find((n) => n.id === clip.id);
    const status = this.app.statusFor(clip.id);
    const diag = this.app.diagnostics(clip.id);
    const track = TRACK_BY_ID[clip.track];
    const code = STATUS_COPY[status.status] || 'Queued';
    const statusDetail = status.status === 'done'
      ? `completed at ${formatClock(clip.start + clip.duration)}`
      : status.status === 'active'
        ? `${Math.round(status.progress * 100)}% · ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)}`
        : `starts at ${formatClock(clip.start)}`;
    const wires = (node?.wiring || []).map((w) => {
      const art = ARTIFACTS[w.type] || { label: w.type, color: '#5d6b7c' };
      const missing = !w.producerId && w.kind !== 'seed' && !w.optional;
      return `
        <div class="wire-row" style="--c:${art.color}">
          <span class="wire-dot"></span>
          <span class="wire-type">${escapeHtml(w.type)}</span>
          <span class="wire-name" style="${missing ? 'color:#c98b8b' : ''}">${escapeHtml(w.producerLabel)}${w.optional && !w.producerId ? ' · optional' : ''}</span>
          <span class="wire-ok" style="${missing ? 'color:#ff6b6b' : ''}">${missing ? '!' : '✓'}</span>
        </div>`;
    }).join('') || '<div class="field-hint">This model has no upstream inputs.</div>';

    const diagnostics = [...diag.errors, ...diag.warnings].map((d) => `
      <div class="diag ${diag.errors.includes(d) ? '' : 'warn'}">
        ${icon(diag.errors.includes(d) ? 'i-alert' : 'i-alert')}
        <span>${escapeHtml(d.message)}</span>
      </div>`).join('');

    return `
      <div class="ins-clip-head" style="--c:${model.color}">
        <span class="ins-glyph">${icon(model.glyph)}</span>
        <div class="ins-title-wrap">
          <div class="ins-title">${escapeHtml(model.name)}</div>
          <div class="ins-vendor">${escapeHtml(model.vendor)} · ${escapeHtml(model.kindLabel)}</div>
        </div>
        <div class="ins-actions">
          <button class="icon-btn" data-action="duplicate" data-id="${clip.id}" title="Duplicate clip">${icon('i-copy')}</button>
          <button class="icon-btn" data-action="delete" data-id="${clip.id}" title="Delete clip">${icon('i-trash')}</button>
        </div>
      </div>

      <div class="ins-status" data-s="${status.status}">
        <span class="sdot"></span>
        <span>${code.toUpperCase()} · ${escapeHtml(statusDetail)}</span>
        <span style="margin-left:auto;color:#6a7787">SIM</span>
      </div>

      <div class="ins-section">
        <div class="ins-section-title"><span>Clip</span><span class="right">${escapeHtml(track?.name || clip.track)}</span></div>
        <div class="pc-row"><span>Start / duration</span><b>${formatClock(clip.start)} · ${clip.duration.toFixed(2)}s</b></div>
        <div class="pc-row"><span>Adapter</span><b>${model.adapter === 'sim' ? 'simulated' : 'built-in'}</b></div>
        <div class="pc-row"><span>Estimate</span><b>${escapeHtml(model.estimate)}</b></div>
        ${model.reference ? `<div class="pc-row"><span>Reference</span><b style="max-width:170px">${escapeHtml(model.reference)}</b></div>` : ''}
      </div>

      <div class="ins-section">
        <div class="ins-section-title"><span>Auto-wiring</span><span class="right">typed inputs</span></div>
        ${wires}
      </div>

      <div class="ins-section">
        <div class="ins-section-title"><span>Parameters</span><span class="right">${model.params.length}</span></div>
        ${model.params.map((param) => this.fieldHTML(param, clip.params?.[param.key])).join('')}
      </div>

      ${diagnostics ? `
      <div class="ins-section">
        <div class="ins-section-title"><span>Diagnostics</span><span class="right">${diag.errors.length} err · ${diag.warnings.length} warn</span></div>
        <div class="diag-list">${diagnostics}</div>
      </div>` : ''}
    `;
  }

  fieldHTML(param, value) {
    const label = `<div class="field-head"><label>${escapeHtml(param.label)}</label>${param.type === 'range' ? `<span class="val">${Number(value).toFixed(param.step < 1 ? 2 : 0).replace(/\.00$/, '')}${param.unit ? ` ${param.unit}` : ''}</span>` : ''}</div>`;
    const common = `data-param="${escapeAttr(param.key)}" data-type="${param.type}"`;
    if (param.type === 'textarea') {
      return `<div class="field">${label}<textarea ${common}>${escapeHtml(value)}</textarea>${param.hint ? `<span class="field-hint">${escapeHtml(param.hint)}</span>` : ''}</div>`;
    }
    if (param.type === 'text') {
      return `<div class="field">${label}<input type="text" ${common} value="${escapeAttr(value)}" spellcheck="false" />${param.hint ? `<span class="field-hint">${escapeHtml(param.hint)}</span>` : ''}</div>`;
    }
    if (param.type === 'number') {
      return `<div class="field">${label}<input type="number" ${common} value="${escapeAttr(value)}" />${param.hint ? `<span class="field-hint">${escapeHtml(param.hint)}</span>` : ''}</div>`;
    }
    if (param.type === 'select') {
      const options = param.options.map(([v, text]) => `<option value="${escapeAttr(v)}" ${String(value) === String(v) ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('');
      return `<div class="field">${label}<select ${common}>${options}</select></div>`;
    }
    if (param.type === 'toggle') {
      return `<div class="toggle-row"><span>${escapeHtml(param.label)}</span><span class="switch"><input type="checkbox" ${common} ${value ? 'checked' : ''}/><i></i></span></div>`;
    }
    if (param.type === 'range') {
      return `<div class="field">${label}<input type="range" ${common} data-unit="${escapeAttr(param.unit || '')}" min="${param.min}" max="${param.max}" step="${param.step}" value="${Number(value)}" />${param.hint ? `<span class="field-hint">${escapeHtml(param.hint)}</span>` : ''}</div>`;
    }
    return '';
  }

  /* ------------------------------ project view ------------------------------ */
  projectHTML() {
    const p = this.app.project;
    const target = p.target;
    const diag = this.app.compile;
    const issues = [...diag.errors.map((e) => ({ ...e, kind: 'err' })), ...diag.warnings.map((w) => ({ ...w, kind: 'warn' }))];
    const counts = diag.nodes.filter((n) => n.model).length;
    return `
      <div class="ins-empty">
        <div class="ins-empty-title">Program settings</div>
        <div class="ins-empty-sub">Select a clip to edit parameters and inspect its auto-wiring.</div>

        <div class="project-card">
          <div class="pc-top">
            <span class="pc-name">${escapeHtml(target.name)}</span>
            <span class="pc-tag">DEMO SURFACE</span>
          </div>
          <div class="pc-rows">
            <div class="pc-row"><span>Asset</span><b>${escapeHtml(target.pdb)}</b></div>
            <div class="pc-row"><span>Organism</span><b>${escapeHtml(target.organism)}</b></div>
            <div class="pc-row"><span>Surface area</span><b>~${(this.app.preview().structure.epitope.area).toLocaleString()} Å² patch</b></div>
          </div>
          <div class="epitope-chips">
            ${target.hotspots.map((h) => `<span class="res-chip">${escapeHtml(h)}</span>`).join('')}
          </div>
        </div>

        <div class="field" style="margin-top:12px">
          <div class="field-head"><label>Target antigen</label></div>
          <select data-project-field="target">
            ${Object.values(TARGETS).map((t) => `<option value="${t.id}" ${t.id === target.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <div class="field-head"><label>Global seed</label><span class="val">deterministic</span></div>
          <input type="number" data-project-field="seed" value="${p.seed}" />
          <span class="field-hint">Every structure and metric is derived from this seed + clip parameters.</span>
        </div>

        <div class="ins-section">
          <div class="ins-section-title"><span>Pipeline check</span><span class="right">${diag.errors.length} err · ${diag.warnings.length} warn</span></div>
          ${issues.length ? `<div class="diag-list">${issues.slice(0, 5).map((d) => `
            <div class="diag ${d.kind === 'warn' ? 'warn' : ''}" ${d.clipId ? `data-action="select-clip" data-id="${d.clipId}" style="cursor:pointer"` : ''}>
              ${icon('i-alert')}<span>${escapeHtml(d.message)}</span>
            </div>`).join('')}</div>` : `
            <div class="diag ok">${icon('i-check')}<span>Compiled cleanly · ${diag.edges.length} typed edges</span></div>`}
        </div>

        <div class="ins-section">
          <div class="ins-section-title"><span>Program</span><span class="right">${counts} clips</span></div>
          <div class="pc-row"><span>Timeline</span><b>${p.duration.toFixed(1)}s · ${p.clips.length} clips</b></div>
          <div class="pc-row"><span>Runtime</span><b>simulation · 0 GPU</b></div>
          <div class="pc-row"><span>Cache</span><b>${this.app.engine.artifacts.size} artifacts</b></div>
        </div>

        <div class="ins-section">
          <div class="ins-section-title"><span>Shortcuts</span><span class="right">keyboard</span></div>
          <div class="ins-shortcuts">
            <span>Play / pause</span><kbd>Space</kbd>
            <span>Render timeline</span><kbd>⌘ ↵</kbd>
            <span>Delete clip</span><kbd>Del</kbd>
            <span>Undo</span><kbd>⌘ Z</kbd>
          </div>
        </div>
      </div>`;
  }

  /* -------------------------------- results -------------------------------- */
  resultsHTML() {
    const { results, resultsStale, selectedCandidate } = this.app.state;
    const header = `
      <div class="results-head">
        <div>
          <h3>Design candidates</h3>
          <p>Ranked by Loopline score · simulated metrics</p>
        </div>
        <span class="result-count">${results.length} / ${this.app.project.clips.find((c) => getModel(c.modelId)?.kind === 'sequence')?.params?.numSeqs || 0}</span>
      </div>`;
    if (!results.length) {
      return `${header}
        <div class="results-placeholder">
          ${icon('i-spark')}
          <p>${resultsStale ? 'Timeline changed' : 'No designs yet'}</p>
          <span>${resultsStale ? 'Render the timeline to regenerate candidates.' : 'Play through a sequence design clip to generate candidates.'}</span>
          <button class="btn" data-action="start-render" style="margin-top:12px">${icon('i-render')}Render timeline</button>
        </div>`;
    }
    return `${header}
      <div class="result-list">
        ${results.map((d, i) => `
          <button class="result-card ${i === selectedCandidate ? 'selected' : ''}" data-index="${i}">
            <div class="rc-top">
              <span class="rc-rank">${d.rank}</span>
              <span class="rc-id">${d.id} · ${d.length} aa</span>
              <span class="rc-score">${d.score.toFixed(1)}</span>
            </div>
            <div class="rc-seq">${escapeHtml(d.seq.slice(0, 46))}…</div>
            <div class="rc-metrics">
              <span class="rc-metric">ipTM <b>${d.metrics.ipTM.toFixed(2)}</b></span>
              <span class="rc-metric">DockQ <b>${d.metrics.dockq.toFixed(2)}</b></span>
              <span class="rc-metric">pLDDT <b>${d.metrics.pLDDT.toFixed(0)}</b></span>
              <span class="rc-metric">hum <b>${d.metrics.humanness.toFixed(0)}</b></span>
            </div>
          </button>`).join('')}
      </div>
      <div class="ins-section">
        <div class="ins-section-title"><span>Selected design</span><span class="right">${results[selectedCandidate]?.id || results[0].id}</span></div>
        <div class="cdr3-block">
          <span>CDR3 · ${(results[selectedCandidate] || results[0]).cdr3.length} aa</span>
          <b>${escapeHtml((results[selectedCandidate] || results[0]).cdr3)}</b>
        </div>
        <div class="pc-row"><span>ΔG estimate</span><b>${results[selectedCandidate]?.metrics.dg ?? results[0].metrics.dg} kcal/mol</b></div>
        <div class="pc-row"><span>Aggregation</span><b>${results[selectedCandidate]?.metrics.aggregation ?? results[0].metrics.aggregation}</b></div>
      </div>
      <div style="display:flex;gap:5px;margin-top:12px">
        <button class="btn" style="flex:1;justify-content:center" data-action="export-fasta">${icon('i-download')}FASTA</button>
        <button class="btn" style="flex:1;justify-content:center" data-action="export-csv">${icon('i-download')}CSV</button>
      </div>
      <div class="field-hint" style="margin-top:10px">All values are simulated. Wire a real adapter before using these designs experimentally.</div>`;
  }
}
