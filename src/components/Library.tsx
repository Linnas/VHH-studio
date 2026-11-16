import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { MODELS, getModel, listTemplates } from '../engine/models.js';
import { Glyph, modelIcon } from '../lib/icons';

const FILTERS: Record<string, (m: any) => boolean> = {
  all: () => true,
  backbone: (m) => m.category === 'generate',
  sequence: (m) => m.category === 'design',
  validate: (m) => m.category === 'predict' || m.category === 'score',
};

export function Library({
  app,
  onDragModel,
}: {
  app: any;
  onDragModel: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const dragEnded = useRef(0);
  const dragId = useRef<string | null>(null);

  const models = useMemo(() => {
    const fn = FILTERS[filter] || FILTERS.all;
    return MODELS.filter(fn).filter((m: any) => {
      if (!query) return true;
      return `${m.name} ${m.vendor} ${m.desc} ${m.kindLabel}`.toLowerCase().includes(query.toLowerCase());
    });
  }, [query, filter]);
  const templates = useMemo(() => listTemplates(), []);

  const add = (id: string) => {
    const model = getModel(id);
    if (model) app.addClip(id, app.state.playhead);
  };

  return (
    <aside className="panel library">
      <div className="panel-head">
        <div>
          <h2>Resources</h2>
          <p className="panel-sub">Models &amp; tools available to the timeline</p>
        </div>
        <span className="count-pill">{models.length}</span>
      </div>

      <div className="ll-library-search">
        <TextInput
          label="Search models"
          isLabelHidden
          size="sm"
          value={query}
          onChange={setQuery}
          placeholder="Search RFdiffusion, MPNN…"
          startIcon={<Glyph name="search" size={13} />}
          hasClear
          containerClassName="ll-field-astryx"
        />
      </div>

      <div className="filter-row">
        {[
          ['all', 'All'],
          ['backbone', 'Generate'],
          ['sequence', 'Design'],
          ['validate', 'Validate'],
        ].map(([value, label]) => (
          <Button
            key={value}
            label={label}
            variant={filter === value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(value)}
            className={`ll-filter ${filter === value ? 'is-active' : ''}`}
          />
        ))}
      </div>

      <div className="scroll-area">
        <div className="model-list">
          {models.map((m: any) => (
            <div
              key={m.id}
              className="model-card"
              role="button"
              tabIndex={0}
              draggable
              style={{ '--c': m.color } as CSSProperties}
              title="Drag to the timeline or click to add at the playhead"
              onDragStart={(e) => {
                dragId.current = m.id;
                onDragModel(m.id);
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-loopline-model', m.id);
                e.dataTransfer.setData('text/plain', m.id);
                e.currentTarget.classList.add('dragging');
              }}
              onDragEnd={(e) => {
                dragEnded.current = performance.now();
                onDragModel(null);
                dragId.current = null;
                e.currentTarget.classList.remove('dragging');
              }}
              onClick={() => {
                if (performance.now() - dragEnded.current < 220) return;
                add(m.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  add(m.id);
                }
              }}
            >
              <div className="mc-top">
                <span className="mc-glyph">
                  <Glyph name={modelIcon(m.glyph)} size={12} />
                </span>
                <span className="mc-name">{m.name}</span>
                <span className="mc-add">+</span>
              </div>
              <p className="mc-desc">{m.desc}</p>
              <div className="mc-meta">
                <span>{m.kindLabel}</span>
                <span className="dot" />
                <span>{m.estimate}</span>
                <span className="gpu">{m.adapter === 'sim' ? 'SIM' : 'BUILT-IN'}</span>
              </div>
            </div>
          ))}
          {!models.length && (
            <div className="ll-empty-note">No models match “{query}”.</div>
          )}
        </div>

        <div className="section-label">
          <span>Templates</span>
          <span className="hint">one-click pipeline</span>
        </div>
        <div className="template-list">
          {templates.map((t: any) => (
            <button
              key={t.id}
              className="template-card"
              style={{ '--c': t.color } as CSSProperties}
              title="Replace the timeline with this template"
              onClick={() => app.applyTemplate(t.id)}
            >
              <span className="tpl-mark" />
              <span className="tpl-body">
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-meta">{t.clips} clips · {t.meta}</span>
              </span>
              <span className="tpl-go">›</span>
            </button>
          ))}
        </div>
      </div>

      <div className="library-foot">
        <Glyph name="spark" size={11} />
        <p>Drag a model onto a track. Inputs are wired automatically by artifact type and timeline order.</p>
      </div>
    </aside>
  );
}
