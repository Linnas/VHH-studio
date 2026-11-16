import { useEffect, useState } from 'react';

export function Toasts({ app }: { app: any }) {
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; kind: string; leaving?: boolean }>>([]);

  useEffect(() => {
    const unsub = app.on('toast', ({ message, kind, id }: any) => {
      setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
        window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 220);
      }, 3200);
    });
    return unsub;
  }, [app]);

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div className={`toast ${t.kind} ${t.leaving ? 'out' : ''}`} key={t.id}>
          <span className="t-dot" />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
