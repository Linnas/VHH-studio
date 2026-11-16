import { useEffect, useRef } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useAppEvents } from '../lib/useAppEvents';
import { Glyph } from '../lib/icons';

export function LogsDrawer({ app }: { app: any }) {
  useAppEvents(app, ['logs']);
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = app.state.logsOpen;
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, app.state.logs.length]);

  return (
    <div className={`logs-drawer ${open ? 'open' : ''}`}>
      <div className="logs-head">
        <span className="logs-title"><span className="live-dot" />Render log</span>
        <span className="logs-sub">{open ? 'streaming' : `${app.state.logs.length} entries`}</span>
        <IconButton
          label="Clear log"
          icon={<Glyph name="trash" size={11} />}
          variant="ghost"
          size="sm"
          onClick={() => {
            app.state.logs = [];
            app.log('Log cleared', 'sys');
          }}
          className="ll-astryx-icon"
        />
        <IconButton
          label="Close log"
          icon={<Glyph name="close" size={11} />}
          variant="ghost"
          size="sm"
          onClick={() => app.toggleLogs(false)}
          className="ll-astryx-icon"
        />
      </div>
      <div className="logs-body" ref={bodyRef}>
        {app.state.logs.map((l: any, i: number) => (
          <div className={`log-line ${l.level}`} key={`${l.t}-${i}`}>
            <span className="lt">{l.t}</span>
            <span className="lm">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
