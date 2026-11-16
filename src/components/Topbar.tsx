import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useAppEvents } from '../lib/useAppEvents';
import { Glyph } from '../lib/icons';

function RenderButton({ app }: { app: any }) {
  useAppEvents(app, ['render', 'tick', 'transport']);
  const rendering = app.state.rendering;
  const pct = Math.round((app.state.playhead / Math.max(0.01, app.project.duration)) * 100);
  return (
    <Button
      label={rendering ? `Rendering ${pct}%` : 'Render'}
      variant="primary"
      size="md"
      icon={<Glyph name={rendering ? 'pause' : 'play'} size={14} />}
      isLoading={rendering}
      isInterruptible
      onClick={() => (rendering ? app.cancelRender() : app.render())}
      tooltip={rendering ? 'Cancel render' : 'Render timeline (Ctrl/Cmd+Enter)'}
      className="ll-render"
    />
  );
}

function SaveState({ app }: { app: any }) {
  const [state, setState] = useState('saved');
  useEffect(() => {
    const unsub = app.on('save', (s: string) => setState(s));
    return unsub;
  }, [app]);
  return <span className={`save-state ${state === 'error' ? 'dirty' : ''}`}>{state === 'error' ? 'save failed' : 'saved'}</span>;
}

export function Topbar({ app }: { app: any }) {
  useAppEvents(app, ['project', 'history']);
  const [name, setName] = useState(app.project.name);
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const compile = app.compile;

  useEffect(() => {
    setName(app.project.name);
  }, [app.project.name]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [exportOpen]);

  const commitName = () => {
    if (name.trim() && name !== app.project.name) app.renameProject(name);
    else setName(app.project.name);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M8.5 21.5c-2.8 0-4.5-2-4.5-4.5s1.7-4.5 4.5-4.5c4 0 6.8 9 10.7 9 2.8 0 4.5-2 4.5-4.5s-1.7-4.5-4.5-4.5c-4 0-6.8 9-10.7 9Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="8.5" cy="21.5" r="1.6" fill="currentColor" />
            <circle cx="19.2" cy="12.5" r="1.6" fill="currentColor" />
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">LOOPLINE</div>
          <div className="brand-sub">VHH DESIGN STUDIO</div>
        </div>
      </div>

      <div className="project-block">
        <span className="eyebrow">PROJECT</span>
        <input
          className="project-name"
          value={name}
          spellCheck={false}
          aria-label="Project name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setName(app.project.name);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <SaveState app={app} />
      </div>

      <div className="top-spacer" />

      <div className={`runtime-badge ${compile.valid ? '' : 'has-error'}`} title="MVP 使用确定性模拟运行时，所有结构与指标均为示意">
        <span className="runtime-dot" />
        <span>SIMULATION</span>
        <span className="runtime-sep" />
        <span className="runtime-meta">LOCAL · 0 GPU</span>
      </div>

      <div className="top-actions">
        <IconButton
          label="Undo"
          icon={<Glyph name="undo" size={15} />}
          variant="ghost"
          size="sm"
          isDisabled={!app.history.length}
          onClick={() => app.undo()}
          tooltip="Undo (Ctrl+Z)"
          className="ll-astryx-icon"
        />
        <IconButton
          label="Redo"
          icon={<Glyph name="redo" size={15} />}
          variant="ghost"
          size="sm"
          isDisabled={!app.future.length}
          onClick={() => app.redo()}
          tooltip="Redo (Ctrl+Shift+Z)"
          className="ll-astryx-icon"
        />
        <span className="divider-v" />
        <div className="menu-wrap" ref={menuRef}>
          <Button
            label="Export"
            variant="secondary"
            size="sm"
            icon={<Glyph name="download" size={14} />}
            endContent={<Glyph name="chevron" size={11} />}
            onClick={() => setExportOpen((v) => !v)}
            className="ll-export"
            tooltip="Export project or designs"
          />
          {exportOpen && (
            <div className="menu">
              {[
                ['project', 'Project file', '.loopline.json'],
                ['fasta', 'Designs', '.fasta'],
                ['pdb', 'Structure', '.pdb'],
                ['csv', 'Metrics', '.csv'],
              ].map(([kind, label, ext]) => (
                <button
                  key={kind}
                  onClick={() => {
                    app.export(kind);
                    setExportOpen(false);
                  }}
                >
                  {label} <span>{ext}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <RenderButton app={app} />
      </div>
    </header>
  );
}
