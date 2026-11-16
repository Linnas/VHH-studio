import { useEffect, useReducer } from 'react';

/** Subscribe a React component to a set of App events. */
export function useAppEvents(app: any, events: string[]) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const key = events.join('|');
  useEffect(() => {
    const unsubs = events.map((event) => app.on(event, force));
    return () => unsubs.forEach((unsub: () => void) => unsub());
  }, [app, key]);
  return force;
}

export function useInterval(callback: () => void, ms: number) {
  useEffect(() => {
    const id = window.setInterval(callback, ms);
    return () => window.clearInterval(id);
  }, [callback, ms]);
}
