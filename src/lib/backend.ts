export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export function pdbUrl(designId: string) {
  return `/api/designs/${encodeURIComponent(designId)}/pdb`;
}

export function formatJobDate(value?: string | null) {
  if (!value) return '—';
  return String(value).replace('T', ' ').replace('Z', '').slice(0, 19);
}

export type TamarindJob = {
  jobName: string;
  status: string;
  type: string;
  created?: string | null;
  completed?: string | null;
  task?: string | null;
  numDesigns?: number | null;
  settings?: Record<string, any>;
  score?: Record<string, any>;
};

export type BackendDesign = {
  id: string;
  runId: string;
  designId: string;
  sequence: string;
  cdrSequences: Record<string, string>;
  metrics: Record<string, string>;
  rank: number;
};

export type BackendRun = {
  id: string;
  jobName: string;
  type?: string;
  task?: string;
  status: string;
  source?: string;
  createdAt: string;
  completedAt?: string | null;
  designCount: number;
  summary?: Record<string, any>;
  designs?: BackendDesign[];
  events?: Array<{ id: number; level: string; message: string; createdAt: string }>;
  error?: string | null;
};
