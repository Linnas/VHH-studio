import { useEffect, useRef, useState } from 'react';
import { createViewer } from '3dmol';
import { useAppEvents } from '../lib/useAppEvents';
import { Glyph } from '../lib/icons';

const CDR_COLORS: Record<string, string> = {
  'H-CDR1': '#5ee7ff',
  'H-CDR2': '#ffb454',
  'H-CDR3': '#ff6fae',
};

function applyLabels(viewer: any, structure: any, show: boolean) {
  viewer.removeAllLabels();
  if (!show) return;
  for (const chain of structure.chains || []) {
    const residues = chain.residues || [];
    const mid = residues[Math.floor(residues.length / 2)];
    const ca = mid?.atoms?.find((a: any) => a.name === 'CA');
    if (ca) {
      viewer.addLabel(chain.role === 'target' ? `TARGET ${chain.id}` : `VHH ${chain.id}`, {
        position: { x: ca.x, y: ca.y, z: ca.z },
        backgroundColor: '#0b1118',
        backgroundOpacity: 0.72,
        borderThickness: 0,
        fontColor: chain.role === 'target' ? '#8fa2b8' : '#b7e36a',
        fontSize: 10,
      });
    }
    if (chain.role !== 'binder') continue;
    // CDRs are color-coded; labels here collide with the ribbons at this scale.
  }
}

function applyStyle(viewer: any, structure: any, mode: 'carbon' | 'stick') {
  viewer.setStyle({}, {});
  const chains = structure.chains || [];

  if (mode === 'carbon') {
    // Carbon: cartoon only. No side-chain sticks at all.
    for (const chain of chains) {
      const base = chain.role === 'target' ? '#7fa8c4' : '#b7e36a';
      viewer.setStyle({ chain: chain.id }, {
        cartoon: { color: base, style: 'rectangle', thickness: 0.32 },
      });
      for (const cdr of chain.cdrs || []) {
        const start = chain.residues?.[cdr.start]?.resSeq;
        const end = chain.residues?.[cdr.end]?.resSeq;
        if (start == null || end == null) continue;
        viewer.addStyle({ chain: chain.id, resi: `${start}-${end}` }, {
          cartoon: { color: CDR_COLORS[cdr.key] || '#ffb454', style: 'rectangle', thickness: 0.32 },
        });
      }
    }
    return;
  }

  // Stick: sticks only. No cartoon / carbon trace underneath.
  for (const chain of chains) {
    const scheme = chain.role === 'target' ? 'blueCarbon' : 'greenCarbon';
    viewer.addStyle({ chain: chain.id }, {
      stick: { radius: 0.14, colorscheme: scheme },
    });
  }
}

export function ThreeDmolViewer({
  app,
  structure,
  onReady,
  onError,
}: {
  app: any;
  structure: any;
  onReady?: (viewer: any) => void;
  onError?: (error: Error) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useAppEvents(app, ['view', 'sticks', 'realDesign', 'labels']);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    const host = hostRef.current;
    if (!host || !structure?.id) return;

    setStatus('loading');
    (async () => {
      try {
        const response = await fetch(`/api/designs/${encodeURIComponent(structure.id)}/pdb`);
        if (!response.ok) throw new Error(`PDB request failed (${response.status})`);
        const pdb = await response.text();
        if (cancelled) return;
        host.innerHTML = '';
        const viewer = createViewer(host, { backgroundColor: '#070b10', antialias: true });
        viewer.addModel(pdb, 'pdb');
        applyStyle(viewer, structure, app.state.stickMode);
        applyLabels(viewer, structure, app.state.labels);
        viewer.zoomTo();
        viewer.zoom(1.16);
        viewer.render();
        if (app.state.spin) viewer.spin('y', 0.6);
        viewerRef.current = viewer;
        app.state.molActive = true;
        onReady?.(viewer);
        observer = new ResizeObserver(() => {
          viewer.resize();
          viewer.render();
        });
        observer.observe(host);
        setStatus('ready');
      } catch (error: any) {
        if (cancelled) return;
        console.error('3Dmol viewer failed:', error);
        app.state.molActive = false;
        setStatus('error');
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      viewerRef.current?.clear();
      viewerRef.current = null;
      app.state.molActive = false;
      onReady?.(null);
      if (host) host.innerHTML = '';
    };
  }, [structure?.id]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    applyStyle(viewer, structure, app.state.stickMode);
    applyLabels(viewer, structure, app.state.labels);
    viewer.render();
  }, [app.state.stickMode, app.state.labels, structure]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (app.state.spin) viewer.spin('y', 0.6);
    else viewer.spin(false, 0);
  }, [app.state.spin]);

  return (
    <div className="mol-viewer">
      <div className="mol-canvas" ref={hostRef} />
      {status === 'loading' && (
        <div className="mol-status"><Glyph name="loader" size={12} className="mol-loader" /> Loading 3Dmol structure…</div>
      )}
      {status === 'error' && (
        <div className="mol-status error">3Dmol / WebGL unavailable — showing fallback renderer.</div>
      )}
    </div>
  );
}
