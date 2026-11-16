import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Badge } from '@astryxdesign/core/Badge';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Slider } from '@astryxdesign/core/Slider';
import { Switch } from '@astryxdesign/core/Switch';
import { TARGETS, TRACK_BY_ID, ARTIFACTS, getModel } from '../engine/models.js';
import { formatClock } from '../engine/rng.js';
import { useAppEvents } from '../lib/useAppEvents';
import { Glyph, modelIcon } from '../lib/icons';

const STATUS_COPY: Record<string, string> = {
  pending: 'Queued',
  active: 'Rendering',
  done: 'Cached',
  error: 'Error',
};

function ClipStatus({ app, clip }: { app: any; clip: any }) {
  useAppEvents(app, ['playhead', 'tick', 'project']);
  const status = app.statusFor(clip.id);
  const detail = status.status === 'done'
    ? `completed at ${formatClock(clip.start + clip.duration)}`
    : status.status === 'active'
      ? `${Math.round(status.progress * 100)}% · ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)}`
      : `starts at ${formatClock(clip.start)}`;
  return (
    <div className="ins-status" data-s={status.status}>
      <span className="sdot" />
      <span>{STATUS_COPY[status.status]?.toUpperCase()} · {detail}</span>
      <span style={{ marginLeft: 'auto', color: '#6a7787' }}>SIM</span>
    </div>
  );
}

function ParamField({ app, clip, param }: { app: any; clip: any; param: any }) {
  const initial = clip.params?.[param.key];
  const [value, setValue] = useState<any>(initial);

  useEffect(() => {
    setValue(clip.params?.[param.key]);
  }, [clip.id, clip.params?.[param.key]]);

  const commit = (next: any) => app.updateParam(clip.id, param.key, next);

  if (param.type === 'range') {
    return (
      <div className="ll-param">
        <Slider
          label={param.label}
          value={Number(value)}
          min={param.min}
          max={param.max}
          step={param.step}
          valueDisplay="text"
          formatValue={(v) => `${Number.isInteger(v) ? v : v.toFixed(2)}${param.unit ? ` ${param.unit}` : ''}`}
          onChange={(v) => setValue(v as number)}
          onChangeEnd={(v) => commit(v)}
          description={param.hint}
        />
      </div>
    );
  }
  if (param.type === 'toggle') {
    return (
      <div className="ll-param">
        <Switch
          label={param.label}
          size="sm"
          value={Boolean(value)}
          onChange={(checked) => commit(checked)}
          labelSpacing="spread"
        />
      </div>
    );
  }
  if (param.type === 'select') {
    return (
      <div className="field ll-native-field">
        <div className="field-head"><label>{param.label}</label></div>
        <select value={String(value)} onChange={(e) => commit(e.target.value)}>
          {param.options.map(([v, label]: [string, string]) => (
            <option value={v} key={v}>{label}</option>
          ))}
        </select>
      </div>
    );
  }
  if (param.type === 'number') {
    return (
      <div className="ll-param">
        <TextInput
          label={param.label}
          size="sm"
          value={String(value ?? '')}
          onChange={(v) => setValue(v)}
          onBlur={() => commit(Number(value))}
          onEnter={() => commit(Number(value))}
          inputMode="numeric"
          containerClassName="ll-field-astryx"
          description={param.hint}
        />
      </div>
    );
  }
  return (
    <div className="ll-param">
      <TextInput
        label={param.label}
        size="sm"
        value={String(value ?? '')}
        onChange={(v) => setValue(v)}
        onBlur={() => commit(String(value))}
        onEnter={() => commit(String(value))}
        containerClassName="ll-field-astryx"
        description={param.hint}
      />
    </div>
  );
}

function ProjectView({ app }: { app: any }) {
  const p = app.project;
  const target = p.target;
  const diag = app.compile;
  const [seed, setSeed] = useState(String(p.seed));
  useEffect(() => setSeed(String(p.seed)), [p.seed]);
  const issues = [
    ...diag.errors.map((e: any) => ({ ...e, kind: 'err' })),
    ...diag.warnings.map((w: any) => ({ ...w, kind: 'warn' })),
  ];
  const preview = app.preview();
  const counts = diag.nodes.filter((n: any) => n.model).length;

  return (
    <div className="ins-empty">
      <div className="ins-empty-title">Program settings</div>
      <div className="ins-empty-sub">Select a clip to edit parameters and inspect its auto-wiring.</div>

      <div className="project-card">
        <div className="pc-top">
          <span className="pc-name">{target.name}</span>
          <span className="pc-tag">DEMO SURFACE</span>
        </div>
        <div className="pc-rows">
          <div className="pc-row"><span>Asset</span><b>{target.pdb}</b></div>
          <div className="pc-row"><span>Organism</span><b>{target.organism}</b></div>
          <div className="pc-row"><span>Surface area</span><b>~{preview.structure.epitope.area.toLocaleString()} Å² patch</b></div>
        </div>
        <div className="epitope-chips">
          {target.hotspots.map((h: string) => <span className="res-chip" key={h}>{h}</span>)}
        </div>
      </div>

      <div className="field ll-native-field" style={{ marginTop: 12 }}>
        <div className="field-head"><label>Target antigen</label></div>
        <select value={target.id} onChange={(e) => app.setTarget(e.target.value)}>
          {Object.values(TARGETS).map((t: any) => (
            <option value={t.id} key={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="ll-param" style={{ marginTop: 10 }}>
        <TextInput
          label="Global seed"
          size="sm"
          value={seed}
          onChange={setSeed}
          onBlur={() => app.setSeed(Number(seed))}
          onEnter={() => app.setSeed(Number(seed))}
          inputMode="numeric"
          containerClassName="ll-field-astryx"
          description="Every structure and metric is derived from this seed + clip parameters."
        />
      </div>

      <div className="ins-section">
        <div className="ins-section-title"><span>Pipeline check</span><span className="right">{diag.errors.length} err · {diag.warnings.length} warn</span></div>
        {issues.length ? (
          <div className="diag-list">
            {issues.slice(0, 5).map((d: any, i: number) => (
              <div
                className={`diag ${d.kind === 'warn' ? 'warn' : ''}`}
                key={`${d.code}-${i}`}
                style={{ cursor: d.clipId ? 'pointer' : 'default' }}
                onClick={() => {
                  if (!d.clipId) return;
                  app.state.selectedId = d.clipId;
                  app.emit('selection');
                }}
              >
                <Glyph name="alert" size={10} />
                <span>{d.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="diag ok"><Glyph name="check" size={10} /><span>Compiled cleanly · {diag.edges.length} typed edges</span></div>
        )}
      </div>

      <div className="ins-section">
        <div className="ins-section-title"><span>Program</span><span className="right">{counts} clips</span></div>
        <div className="pc-row"><span>Timeline</span><b>{p.duration.toFixed(1)}s · {p.clips.length} clips</b></div>
        <div className="pc-row"><span>Runtime</span><b>simulation · 0 GPU</b></div>
        <div className="pc-row"><span>Cache</span><b>{app.engine.artifacts.size} artifacts</b></div>
      </div>

      <div className="ins-section">
        <div className="ins-section-title"><span>Shortcuts</span><span className="right">keyboard</span></div>
        <div className="ins-shortcuts">
          <span>Play / pause</span><kbd>Space</kbd>
          <span>Render timeline</span><kbd>⌘ ↵</kbd>
          <span>Delete clip</span><kbd>Del</kbd>
          <span>Undo</span><kbd>⌘ Z</kbd>
        </div>
      </div>
    </div>
  );
}

function ClipView({ app, clip }: { app: any; clip: any }) {
  const model = getModel(clip.modelId);
  if (!model) return <ProjectView app={app} />;
  const node = app.compile.nodes.find((n: any) => n.id === clip.id);
  const diag = app.diagnostics(clip.id);
  const track = TRACK_BY_ID[clip.track];
  const wires = node?.wiring || [];
  const diagnostics = [...diag.errors, ...diag.warnings];

  return (
    <>
      <div className="ins-clip-head" style={{ '--c': model.color } as CSSProperties}>
        <span className="ins-glyph"><Glyph name={modelIcon(model.glyph)} size={15} /></span>
        <div className="ins-title-wrap">
          <div className="ins-title">{model.name}</div>
          <div className="ins-vendor">{model.vendor} · {model.kindLabel}</div>
        </div>
        <div className="ins-actions">
          <IconButton label="Duplicate clip" icon={<Glyph name="copy" size={12} />} variant="ghost" size="sm" onClick={() => app.duplicateClip(clip.id)} className="ll-astryx-icon" />
          <IconButton label="Delete clip" icon={<Glyph name="trash" size={12} />} variant="ghost" size="sm" onClick={() => app.deleteClip(clip.id)} className="ll-astryx-icon" />
        </div>
      </div>

      <ClipStatus app={app} clip={clip} />

      <div className="ins-section">
        <div className="ins-section-title"><span>Clip</span><span className="right">{track?.name || clip.track}</span></div>
        <div className="pc-row"><span>Start / duration</span><b>{formatClock(clip.start)} · {clip.duration.toFixed(2)}s</b></div>
        <div className="pc-row"><span>Adapter</span><b>{model.adapter === 'sim' ? 'simulated' : 'built-in'}</b></div>
        <div className="pc-row"><span>Estimate</span><b>{model.estimate}</b></div>
        {model.reference && <div className="pc-row"><span>Reference</span><b style={{ maxWidth: 170 }}>{model.reference}</b></div>}
      </div>

      <div className="ins-section">
        <div className="ins-section-title"><span>Auto-wiring</span><span className="right">typed inputs</span></div>
        {wires.length ? wires.map((w: any) => {
          const art = ARTIFACTS[w.type] || { label: w.type, color: '#5d6b7c' };
          const missing = !w.producerId && w.kind !== 'seed' && !w.optional;
          return (
            <div className="wire-row" key={`${w.type}-${w.producerId || 'none'}`} style={{ '--c': art.color } as CSSProperties}>
              <span className="wire-dot" />
              <span className="wire-type">{w.type}</span>
              <span className="wire-name" style={missing ? { color: '#c98b8b' } : undefined}>
                {w.producerLabel}{w.optional && !w.producerId ? ' · optional' : ''}
              </span>
              <span className="wire-ok" style={missing ? { color: '#ff6b6b' } : undefined}>{missing ? '!' : '✓'}</span>
            </div>
          );
        }) : <div className="field-hint">This model has no upstream inputs.</div>}
      </div>

      <div className="ins-section">
        <div className="ins-section-title"><span>Parameters</span><span className="right">{model.params.length}</span></div>
        {model.params.map((param: any) => <ParamField app={app} clip={clip} param={param} key={param.key} />)}
      </div>

      {diagnostics.length > 0 && (
        <div className="ins-section">
          <div className="ins-section-title"><span>Diagnostics</span><span className="right">{diag.errors.length} err · {diag.warnings.length} warn</span></div>
          <div className="diag-list">
            {diagnostics.map((d: any, i: number) => (
              <div className={`diag ${diag.warnings.includes(d) ? 'warn' : ''}`} key={i}>
                <Glyph name="alert" size={10} /><span>{d.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ResultsView({ app }: { app: any }) {
  const { results, resultsStale, selectedCandidate } = app.state;
  const design = results[selectedCandidate] || results[0];
  return (
    <>
      <div className="results-head">
        <div>
          <h3>Design candidates</h3>
          <p>Ranked by Loopline score · simulated metrics</p>
        </div>
        <span className="result-count">{results.length}</span>
      </div>
      {!results.length ? (
        <div className="results-placeholder">
          <Glyph name="spark" size={24} />
          <p>{resultsStale ? 'Timeline changed' : 'No designs yet'}</p>
          <span>{resultsStale ? 'Render the timeline to regenerate candidates.' : 'Play through a sequence design clip to generate candidates.'}</span>
          <Button label="Render timeline" variant="secondary" size="sm" icon={<Glyph name="play" size={12} />} onClick={() => app.render()} style={{ marginTop: 12 }} />
        </div>
      ) : (
        <>
          <div className="result-list">
            {results.map((d: any, i: number) => (
              <button
                className={`result-card ${i === selectedCandidate ? 'selected' : ''}`}
                key={d.id}
                onClick={() => app.setCandidate(i)}
              >
                <div className="rc-top">
                  <span className="rc-rank">{d.rank}</span>
                  <span className="rc-id">{d.id} · {d.length} aa</span>
                  <span className="rc-score">{d.score.toFixed(1)}</span>
                </div>
                <div className="rc-seq">{d.seq.slice(0, 46)}…</div>
                <div className="rc-metrics">
                  <span className="rc-metric">ipTM <b>{d.metrics.ipTM.toFixed(2)}</b></span>
                  <span className="rc-metric">DockQ <b>{d.metrics.dockq.toFixed(2)}</b></span>
                  <span className="rc-metric">pLDDT <b>{d.metrics.pLDDT.toFixed(0)}</b></span>
                  <span className="rc-metric">hum <b>{d.metrics.humanness.toFixed(0)}</b></span>
                </div>
              </button>
            ))}
          </div>
          {design && (
            <>
              <div className="ins-section">
                <div className="ins-section-title"><span>Selected design</span><span className="right">{design.id}</span></div>
                <div className="cdr3-block">
                  <span>CDR3 · {design.cdr3.length} aa</span>
                  <b>{design.cdr3}</b>
                </div>
                <div className="pc-row"><span>ΔG estimate</span><b>{design.metrics.dg} kcal/mol</b></div>
                <div className="pc-row"><span>Aggregation</span><b>{design.metrics.aggregation}</b></div>
              </div>
              <div className="ll-export-results">
                <Button label="FASTA" variant="secondary" size="sm" icon={<Glyph name="download" size={12} />} onClick={() => app.export('fasta')} />
                <Button label="CSV" variant="secondary" size="sm" icon={<Glyph name="download" size={12} />} onClick={() => app.export('csv')} />
              </div>
              <div className="field-hint" style={{ marginTop: 10 }}>All values are simulated. Wire a real adapter before using these designs experimentally.</div>
            </>
          )}
        </>
      )}
    </>
  );
}

export function Inspector({ app }: { app: any }) {
  useAppEvents(app, ['project', 'selection', 'tab', 'results', 'candidate']);
  const tab = app.state.tab;
  const clip = app.selectedClip();
  const count = app.state.results.length;

  return (
    <aside className="panel inspector">
      <TabList
        value={tab}
        onChange={(next) => app.setTab(next)}
        size="sm"
        className="ll-inspector-tabs"
        aria-label="Inspector sections"
        role="tablist"
      >
        <Tab value="inspector" label="Inspector" panelId="inspector-panel" />
        <Tab value="results" label="Results" panelId="results-panel" endContent={<Badge label={String(count)} variant="neutral" />} />
      </TabList>
      <div
        className="inspector-body"
        id={tab === 'results' ? 'results-panel' : 'inspector-panel'}
        role="tabpanel"
        aria-label={tab === 'results' ? 'Design results' : 'Clip inspector'}
      >
        {tab === 'results' ? <ResultsView app={app} /> : clip ? <ClipView app={app} clip={clip} /> : <ProjectView app={app} />}
      </div>
    </aside>
  );
}
