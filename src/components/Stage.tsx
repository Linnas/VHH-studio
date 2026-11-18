import { useEffect, useRef, useState } from 'react';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Monitor } from '../ui/monitor.js';
import { ThreeDmolViewer } from './ThreeDmolViewer';
import { useAppEvents } from '../lib/useAppEvents';
import { Glyph } from '../lib/icons';

function StageMeta({ app }: { app: any }) {
  useAppEvents(app, ['project']);
  const c = app.compile;
  const clips = c.nodes.filter((n: any) => n.model).length;
  return (
    <div className="stage-meta" id="stageMeta">
      <span className={c.errors.length ? 'bad' : 'ok'}>
        ● {c.errors.length ? `${c.errors.length} error${c.errors.length > 1 ? 's' : ''}` : 'pipeline ready'}
      </span>
      <span className="ll-meta-sep">/</span>
      <span>{clips} clips</span>
      <span className="ll-meta-sep">·</span>
      <span>{c.edges.length} edges</span>
      {c.warnings.length > 0 && <span className="ll-meta-warn">· {c.warnings.length} warn</span>}
    </div>
  );
}

export function Stage({ app }: { app: any }) {
  useAppEvents(app, ['view', 'realDesign', 'sticks']);
  const monitorRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const [molFailed, setMolFailed] = useState(false);
  const view = app.state.view;
  const real = app.state.realDesign;

  useEffect(() => {
    if (!monitorRef.current) monitorRef.current = new Monitor(app);
    return () => {
      monitorRef.current?.destroy?.();
      monitorRef.current = null;
    };
  }, [app]);

  useEffect(() => {
    setMolFailed(false);
  }, [real?.designId]);

  return (
    <section className="stage" id="monitor-panel" role="tabpanel" aria-label="Monitor preview">
      <div className="stage-bar">
        <TabList
          value={view}
          onChange={(next) => app.setView(next)}
          size="sm"
          className="view-tabs ll-astryx-tabs"
          aria-label="Monitor view"
          role="tablist"
        >
          <Tab value="3d" label="3D Preview" panelId="monitor-panel" icon={<Glyph name="layers" size={12} />} />
          <Tab value="flow" label="Flow Map" panelId="monitor-panel" icon={<Glyph name="flow" size={12} />} />
          <Tab value="sequence" label="Sequence" panelId="monitor-panel" icon={<Glyph name="dna" size={12} />} />
        </TabList>
        <div className="stage-bar-spacer" />
        {real && (
          <button className="ll-real-chip" onClick={() => app.clearRealDesign()} title="Return to the simulated preview">
            <span className="ll-real-dot" />
            <span className="ll-real-name">{real.designId}</span>
            <span className="ll-real-x">×</span>
          </button>
        )}
        <StageMeta app={app} />
        <div className="stage-tools">
          <IconButton
            label="Auto-rotate"
            icon={<Glyph name="rotate" size={13} />}
            variant={app.state.spin ? 'secondary' : 'ghost'}
            size="sm"
            isDisabled={view !== '3d'}
            onClick={() => app.toggleSpin()}
            tooltip="Auto-rotate"
            className="ll-astryx-icon"
          />
          <IconButton
            label="Toggle labels"
            icon={<Glyph name={app.state.labels ? 'eye' : 'eyeOff'} size={13} />}
            variant={app.state.labels ? 'secondary' : 'ghost'}
            size="sm"
            isDisabled={view !== '3d'}
            onClick={() => app.toggleLabels()}
            tooltip="Toggle labels"
            className="ll-astryx-icon"
          />
          <Button
            label={app.state.stickMode === 'stick' ? 'Stick' : 'Carbon'}
            variant={app.state.stickMode === 'stick' ? 'secondary' : 'ghost'}
            size="sm"
            icon={<Glyph name="atom" size={13} />}
            isDisabled={!real || view !== '3d'}
            onClick={() => app.toggleSticks()}
            tooltip={`Representation: ${app.state.stickMode === 'stick' ? 'stick' : 'carbon cartoon'}. Click to switch to ${app.state.stickMode === 'stick' ? 'carbon' : 'stick'}.`}
            className="ll-astryx-button ll-stick-toggle"
          />
          <IconButton
            label="Reset camera"
            icon={<Glyph name="expand" size={13} />}
            variant="ghost"
            size="sm"
            onClick={() => {
              if (viewerRef.current) {
                viewerRef.current.zoomTo();
                viewerRef.current.zoom(1.16);
                viewerRef.current.render();
              } else {
                monitorRef.current?.resetCamera();
              }
            }}
            tooltip="Reset camera"
            className="ll-astryx-icon"
          />
        </div>
      </div>

      <div className={`monitor ${real && view === '3d' && !molFailed ? 'has-real' : ''}`} id="monitorWrap" data-view={view}>
        <canvas id="monitorCanvas" />
        {real && view === '3d' && !molFailed && (
          <ThreeDmolViewer
            app={app}
            structure={real}
            onReady={(viewer) => { viewerRef.current = viewer; }}
            onError={() => setMolFailed(true)}
          />
        )}        <div className="monitor-top">
          <div className="monitor-title">
            <span className="live-dot" id="liveDot" />
            <div>
              <div className="monitor-kicker" id="monitorKicker">STANDBY</div>
              <div className="monitor-stage" id="monitorStage">Target surface</div>
            </div>
          </div>
          <div className="monitor-pills" id="monitorPills" />
        </div>
        <div className="monitor-empty" id="monitorEmpty">
          <div className="empty-orb" />
          <div>
            <p>尚未渲染骨架</p>
            <span>把 RFdiffusion 拖到 Backbone 轨，或按 <kbd>Space</kbd> 播放时间线</span>
          </div>
        </div>
        <div className="monitor-legend" id="monitorLegend" />
        <div className="monitor-tc">
          <span className="tc-dot" />
          <span id="monitorTc">00:00:00</span>
          <span className="tc-sep">·</span>
          <span>24 fps preview</span>
        </div>
      </div>
    </section>
  );
}
