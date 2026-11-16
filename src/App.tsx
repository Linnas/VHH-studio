import { useEffect, useRef, useState } from 'react';
import { App as LooplineApp } from './state.js';
import { Topbar } from './components/Topbar';
import { Library } from './components/Library';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { LogsDrawer } from './components/LogsDrawer';
import { Toasts } from './components/Toasts';

export function App() {
  const appRef = useRef<any>(null);
  if (!appRef.current) appRef.current = new LooplineApp();
  const app = appRef.current;
  const [dragModel, setDragModel] = useState<string | null>(null);

  useEffect(() => {
    const isTyping = () => {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const role = active?.getAttribute('role');
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON'
        || Boolean(active?.isContentEditable)
        || role === 'slider' || role === 'switch' || role === 'tab' || role === 'checkbox' || role === 'button';
    };

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (app.state.rendering) app.cancelRender();
        else app.render();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !isTyping()) {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTyping()) {
        e.preventDefault();
        app.redo();
        return;
      }
      if (isTyping()) {
        if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        app.togglePlay();
      } else if (e.key === 'Home') {
        e.preventDefault();
        app.setPlayhead(0, { user: true });
      } else if (e.key === 'End') {
        e.preventDefault();
        app.setPlayhead(app.project.duration, { user: true });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        app.step(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        app.step(e.shiftKey ? 10 : 1);
      } else if (e.key.toLowerCase() === 'l' && !mod) {
        app.toggleLogs();
      } else if (['1', '2', '3'].includes(e.key) && !mod) {
        app.setView({ 1: '3d', 2: 'flow', 3: 'sequence' }[e.key]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && app.state.selectedId) {
        e.preventDefault();
        app.deleteClip(app.state.selectedId);
      } else if (e.key === 'Escape') {
        app.state.selectedId = null;
        app.emit('selection');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  useEffect(() => {
    const onBeforeUnload = () => app.save();
    window.addEventListener('beforeunload', onBeforeUnload);
    (window as any).__loopline = { app };
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [app]);

  return (
    <div id="app" className="ll-root">
      <Topbar app={app} />
      <main className="workspace">
        <Library app={app} onDragModel={setDragModel} />
        <Stage app={app} />
        <Inspector app={app} />
      </main>
      <Timeline app={app} dragModel={dragModel} />
      <LogsDrawer app={app} />
      <Toasts app={app} />
    </div>
  );
}
