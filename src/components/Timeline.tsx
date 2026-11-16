import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Switch } from '@astryxdesign/core/Switch';
import { Slider } from '@astryxdesign/core/Slider';
import { TRACKS, getModel, clipSummary } from '../engine/models.js';
import { clamp, formatClock, formatTimecode, hashString, roundTo } from '../engine/rng.js';
import { useAppEvents } from '../lib/useAppEvents';
import { Glyph, modelIcon } from '../lib/icons';

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origStart: number;
  origDuration: number;
  origTrack: string;
  start: number;
  duration: number;
  track: string;
  moved: boolean;
};

function sparkPath(id: string) {
  const h = hashString(id);
  let d = 'M0 6';
  for (let i = 0; i < 23; i++) {
    const x = i * 2;
    const y = 6 + Math.sin((h % 41) / 5 + i * 0.82) * 2.8 + Math.sin(i * 0.3 + (h % 13)) * 1.2;
    d += ` L${x} ${y.toFixed(2)}`;
  }
  return d;
}

function Timecode({ app }: { app: any }) {
  useAppEvents(app, ['project', 'playhead', 'tick']);
  return (
    <div className="timecode">
      <span className="tc-cur">{formatTimecode(app.state.playhead, app.project.fps)}</span>
      <span className="tc-total">/ {formatTimecode(app.project.duration, app.project.fps)}</span>
    </div>
  );
}

export function Timeline({ app, dragModel }: { app: any; dragModel: string | null }) {
  useAppEvents(app, ['project', 'playhead', 'tick', 'selection', 'zoom', 'logs']);
  const p = app.project;
  const pps = app.state.zoom;
  const duration = p.duration;
  const contentW = Math.max(duration * pps + 12, 300);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [dropTime, setDropTime] = useState<number | null>(null);
  const didFit = useRef(false);

  useEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    const el = scrollRef.current;
    if (!el) return;
    if (app.state.zoom <= 56) {
      app.setZoom(clamp((el.clientWidth - 18) / Math.max(1, duration), 28, 140));
    }
  }, [app, duration]);

  const counts = Object.fromEntries(TRACKS.map((t: any) => [t.id, 0]));
  for (const c of p.clips) counts[c.track] = (counts[c.track] || 0) + 1;

  useEffect(() => {
    if (!app.state.playing) return;
    const sc = scrollRef.current;
    if (!sc) return;
    const x = app.state.playhead * pps;
    if (x > sc.scrollLeft + sc.clientWidth - 90) sc.scrollLeft = x - sc.clientWidth * 0.55;
    else if (x < sc.scrollLeft + 18) sc.scrollLeft = Math.max(0, x - 50);
  }, [app.state.playhead, app.state.playing, pps]);

  useEffect(() => () => document.body.classList.remove('is-editing'), []);

  const timeAt = (clientX: number) => {
    const el = contentRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left) / pps, 0, duration);
  };

  const trackAt = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    return el?.closest('.lane')?.getAttribute('data-track') || null;
  };

  const startDrag = (e: ReactPointerEvent, clip: any, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    if (!app.state.rendering) app.pause();
    app.state.selectedId = clip.id;
    app.emit('selection');
    const state: DragState = {
      id: clip.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origStart: clip.start,
      origDuration: clip.duration,
      origTrack: clip.track,
      start: clip.start,
      duration: clip.duration,
      track: clip.track,
      moved: false,
    };
    dragRef.current = state;
    setDrag({ ...state });
    document.body.classList.add('is-editing');

    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = ev.clientX - cur.startX;
      if (!cur.moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - cur.startY) < 3) return;
      cur.moved = true;
      if (cur.mode === 'move') {
        cur.start = app.snapTime(cur.origStart + dx / pps);
        cur.track = trackAt(ev.clientX, ev.clientY) || cur.track;
      } else {
        const raw = cur.origDuration + dx / pps;
        cur.duration = Math.max(0.5, app.state.snap ? roundTo(raw, 0.25) : raw);
      }
      setDrag({ ...cur });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('is-editing');
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (cur?.moved) {
        if (cur.mode === 'move') app.moveClip(cur.id, cur.start, cur.track);
        else app.resizeClip(cur.id, cur.duration);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const beginScrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    app.pause();
    setScrubbing(true);
    app.setPlayhead(timeAt(e.clientX), { user: true });
    const move = (ev: PointerEvent) => app.setPlayhead(timeAt(ev.clientX), { user: true });
    const up = () => {
      setScrubbing(false);
      window.removeEventListener('pointermove', move);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const labelSteps = [0.5, 1, 2, 5, 10, 20, 30, 60];
  const labelStep = labelSteps.find((s) => s * pps >= 66) || 60;
  const minor = labelStep / 2;
  const ticks: Array<{ t: number; major: boolean }> = [];
  for (let t = 0; t <= duration + 0.001; t = +(t + minor).toFixed(3)) {
    ticks.push({ t, major: Math.abs(t % labelStep) < 0.001 });
  }

  const nativeTrack = dragModel ? getModel(dragModel)?.track : null;
  const dropModel = dragModel ? getModel(dragModel) : null;

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <div className="transport">
          <IconButton
            label="Go to start"
            icon={<Glyph name="start" size={13} />}
            variant="ghost"
            size="sm"
            onClick={() => app.setPlayhead(0, { user: true })}
            tooltip="Go to start (Home)"
            className="ll-astryx-icon"
          />
          <IconButton
            label={app.state.playing ? 'Pause' : 'Play'}
            icon={<Glyph name={app.state.playing ? 'pause' : 'play'} size={14} />}
            variant="primary"
            size="md"
            onClick={() => app.togglePlay()}
            tooltip={app.state.playing ? 'Pause (Space)' : 'Play (Space)'}
            className="ll-play-btn"
          />
          <IconButton
            label="Go to end"
            icon={<Glyph name="end" size={13} />}
            variant="ghost"
            size="sm"
            onClick={() => app.setPlayhead(app.project.duration, { user: true })}
            tooltip="Go to end (End)"
            className="ll-astryx-icon"
          />
        </div>
        <Timecode app={app} />
        <div className="playback-rate">
          {[0.5, 1, 2, 4].map((rate) => (
            <button
              key={rate}
              className={app.state.speed === rate ? 'active' : ''}
              onClick={() => app.setSpeed(rate)}
            >
              {rate}×
            </button>
          ))}
        </div>
        <div className="tl-toolbar-spacer" />
        <Switch
          label="Snap"
          size="sm"
          value={app.state.snap}
          onChange={() => app.toggleSnap()}
          labelPosition="start"
          className="ll-snap"
        />
        <div className="ll-zoom">
          <Glyph name="search" size={11} />
          <Slider
            label="Timeline zoom"
            isLabelHidden
            value={pps}
            min={28}
            max={140}
            step={1}
            valueDisplay="none"
            onChange={(v) => app.setZoom(v as number)}
          />
        </div>
        <Button
          label="Fit"
          variant="ghost"
          size="sm"
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            app.setZoom(clamp((el.clientWidth - 18) / Math.max(1, duration), 28, 140));
            el.scrollLeft = 0;
          }}
          className="ll-tool"
          tooltip="Fit the whole timeline"
        />
        <Button
          label={`Logs ${app.state.logs.length}`}
          variant="ghost"
          size="sm"
          icon={<Glyph name="terminal" size={12} />}
          onClick={() => app.toggleLogs()}
          className="ll-tool"
          tooltip="Open render log"
        />
      </div>

      <div className="tl-main">
        <div className="tl-heads">
          <div className="tl-corner">
            <span>TRACKS</span>
            <span className="tl-corner-hint">{TRACKS.length}</span>
          </div>
          {TRACKS.map((t: any) => (
            <div className="track-head" key={t.id} style={{ '--c': t.color } as CSSProperties}>
              <span className="track-dot" />
              <span className="track-info">
                <span className="track-name">{t.name}</span>
                <span className="track-desc">{t.desc}</span>
              </span>
              <span className={`track-count ${counts[t.id] ? 'has' : ''}`}>{counts[t.id] || 0}</span>
            </div>
          ))}
        </div>

        <div
          className="tl-scroll"
          ref={scrollRef}
          onDragOver={(e) => {
            if (!dragModel) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropTime(app.snapTime(timeAt(e.clientX)));
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropTime(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = dragModel || e.dataTransfer.getData('application/x-loopline-model') || e.dataTransfer.getData('text/plain');
            const t = app.snapTime(timeAt(e.clientX));
            setDropTime(null);
            if (getModel(id)) app.addClip(id, t);
          }}
        >
          <div
            className={`tl-content ${scrubbing ? 'scrubbing' : ''} ${dropTime != null ? 'drop-active' : ''}`}
            ref={contentRef}
            style={{ width: contentW, '--grid': `${Math.max(20, pps / 2)}px` } as CSSProperties}
          >
            <div className="ruler" onPointerDown={beginScrub}>
              {ticks.map(({ t, major }) => (
                <span key={t}>
                  <span className={`ruler-tick ${major ? '' : 'minor'}`} style={{ left: t * pps }} />
                  {major && <span className="ruler-label" style={{ left: t * pps }}>{labelStep >= 1 ? `${Math.round(t)}s` : `${t.toFixed(1)}s`}</span>}
                </span>
              ))}
            </div>

            <div className="lanes">
              {TRACKS.map((t: any) => {
                const clipList = p.clips.filter((c: any) => (drag?.id === c.id ? drag.track : c.track) === t.id);
                return (
                  <div
                    className={`lane ${nativeTrack === t.id ? 'drop-target' : ''}`}
                    data-track={t.id}
                    key={t.id}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || (e.target as HTMLElement).closest('.clip')) return;
                      app.state.selectedId = null;
                      app.emit('selection');
                      app.pause();
                      app.setPlayhead(timeAt(e.clientX), { user: true });
                    }}
                  >
                    {!clipList.length && (
                      <span className="lane-empty-hint">
                        {t.id === 'epitope' ? 'Map the surface patch here' : t.id === 'backbone' ? 'Drop RFdiffusion / PROTEINA here' : `Drop ${t.name.toLowerCase()} models here`}
                      </span>
                    )}
                    {clipList.map((clip: any) => {
                      const activeDrag = drag?.id === clip.id ? drag : null;
                      const effective = activeDrag
                        ? { ...clip, start: activeDrag.start, duration: activeDrag.duration, track: activeDrag.track }
                        : clip;
                      const model = getModel(clip.modelId);
                      if (!model) return null;
                      const status = app.statusFor(clip.id);
                      const width = Math.max(22, effective.duration * pps - 1);
                      const compact = width < 58;
                      const selected = app.state.selectedId === clip.id;
                      return (
                        <div
                          className={`clip ${compact ? 'compact' : ''} ${selected ? 'selected' : ''} ${activeDrag ? 'dragging' : ''}`}
                          key={clip.id}
                          data-id={clip.id}
                          data-status={status.status}
                          role="button"
                          tabIndex={0}
                          title={`${model.name} · ${formatClock(clip.start)}–${formatClock(clip.start + clip.duration)} · ${clipSummary(clip)}`}
                          style={{
                            left: effective.start * pps,
                            width,
                            '--clip': model.color,
                          } as CSSProperties}
                          onPointerDown={(e) => {
                            const mode = (e.target as HTMLElement).closest('.clip-handle') ? 'resize' : 'move';
                            startDrag(e, clip, mode);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              app.state.selectedId = clip.id;
                              app.emit('selection');
                            }
                          }}
                          onDoubleClick={() => app.setTab('inspector')}
                        >
                          <span className="clip-stripe" />
                          <div className="clip-body">
                            <div className="clip-top">
                              <span className="clip-icon"><Glyph name={modelIcon(model.glyph)} size={9} /></span>
                              <span className="clip-name">{model.name}</span>
                              <span className="clip-dur">{effective.duration.toFixed(1)}s</span>
                            </div>
                            <div className="clip-sub">{clipSummary(clip)}</div>
                          </div>
                          <svg className="clip-spark" viewBox="0 0 46 12" preserveAspectRatio="none" aria-hidden="true">
                            <path d={sparkPath(clip.id)} fill="none" stroke={model.color} strokeWidth="0.8" strokeLinecap="round" />
                          </svg>
                          <span className="clip-progress" style={{ width: `${status.progress * 100}%` }} />
                          <span className="clip-badge"><Glyph name="check" size={8} /></span>
                          <span className="clip-handle" title="Trim duration" />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {dropTime != null && (
              <div className="drop-marker show" style={{ left: dropTime * pps }}>
                <span>{formatTimecode(dropTime, p.fps)}</span>
              </div>
            )}

            <div className="playhead" style={{ transform: `translateX(${app.state.playhead * pps}px)` }}>
              <div className="ph-head" />
              <div className="ph-line" />
            </div>

            {dropModel && dropTime != null && (
              <div className="ll-drop-chip" style={{ left: dropTime * pps }}>
                {dropModel.name} → {formatClock(dropTime)}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
