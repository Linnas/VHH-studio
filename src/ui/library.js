/* Resource library: models are draggable clips; templates replace the timeline. */

import { MODELS, listTemplates, getModel } from '../engine/models.js';
import { icon, escapeHtml, qs } from './dom.js';

const FILTERS = {
  all: () => true,
  backbone: (m) => m.category === 'generate',
  sequence: (m) => m.category === 'design',
  validate: (m) => m.category === 'predict' || m.category === 'score',
};

export class Library {
  constructor(app) {
    this.app = app;
    this.root = qs('#modelList');
    this.countEl = qs('#modelCount');
    this.searchEl = qs('#modelSearch');
    this.filterEl = qs('#modelFilters');
    this.templateEl = qs('#templateList');
    this.filter = 'all';
    this.query = '';
    this.dragModel = null;
    this.dragEndedAt = 0;
    this.bind();
    this.render();
  }

  bind() {
    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.render();
    });
    this.filterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      this.filter = btn.dataset.filter;
      for (const b of this.filterEl.querySelectorAll('[data-filter]')) b.classList.toggle('active', b === btn);
      this.render();
    });

    this.root.addEventListener('dragstart', (e) => {
      const card = e.target.closest('[data-model]');
      if (!card) return;
      this.dragModel = card.dataset.model;
      this.app.dragModel = this.dragModel;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      try {
        e.dataTransfer.setData('application/x-loopline-model', this.dragModel);
        e.dataTransfer.setData('text/plain', this.dragModel);
      } catch { /* Safari */ }
    });
    this.root.addEventListener('dragend', (e) => {
      const card = e.target.closest('[data-model]');
      if (card) card.classList.remove('dragging');
      this.dragEndedAt = performance.now();
      this.app.dragModel = null;
      this.dragModel = null;
    });
    this.root.addEventListener('click', (e) => {
      const card = e.target.closest('[data-model]');
      if (!card) return;
      if (performance.now() - this.dragEndedAt < 220) return;
      this.addModel(card.dataset.model);
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-model]');
      if (!card) return;
      e.preventDefault();
      this.addModel(card.dataset.model);
    });

    this.templateEl.addEventListener('click', (e) => {
      const card = e.target.closest('[data-template]');
      if (!card) return;
      this.app.applyTemplate(card.dataset.template);
    });
  }

  addModel(modelId) {
    const model = getModel(modelId);
    if (!model) return;
    this.app.addClip(modelId, this.app.state.playhead);
  }

  render() {
    const filterFn = FILTERS[this.filter] || FILTERS.all;
    const models = MODELS.filter((m) => filterFn(m)).filter((m) => {
      if (!this.query) return true;
      return `${m.name} ${m.vendor} ${m.desc} ${m.kindLabel}`.toLowerCase().includes(this.query);
    });
    this.countEl.textContent = String(models.length);
    this.root.innerHTML = models.map((m) => this.card(m)).join('') || `
      <div style="padding:20px 8px;text-align:center;font-size:9px;color:#3d4a5a">No models match “${escapeHtml(this.query)}”.</div>
    `;
    this.renderTemplates();
  }

  card(m) {
    return `
      <div class="model-card" data-model="${m.id}" draggable="true" tabindex="0" role="button"
           title="Drag to the timeline or click to add at the playhead" style="--c:${m.color}">
        <div class="mc-top">
          <span class="mc-glyph">${icon(m.glyph)}</span>
          <span class="mc-name">${escapeHtml(m.name)}</span>
          <span class="mc-add">+</span>
        </div>
        <p class="mc-desc">${escapeHtml(m.desc)}</p>
        <div class="mc-meta">
          <span>${escapeHtml(m.kindLabel)}</span>
          <span class="dot"></span>
          <span>${escapeHtml(m.estimate)}</span>
          <span class="gpu">${m.adapter === 'sim' ? 'SIM' : 'BUILT-IN'}</span>
        </div>
      </div>`;
  }

  renderTemplates() {
    const templates = listTemplates();
    this.templateEl.innerHTML = templates.map((t) => `
      <button class="template-card" data-template="${t.id}" style="--c:${t.color}" title="Replace the timeline with this template">
        <span class="tpl-mark"></span>
        <span class="tpl-body">
          <span class="tpl-name">${escapeHtml(t.name)}</span>
          <span class="tpl-meta">${t.clips} clips · ${escapeHtml(t.meta)}</span>
        </span>
        <span class="tpl-go">›</span>
      </button>`).join('');
  }
}
