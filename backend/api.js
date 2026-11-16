import { TamarindError } from './tamarind.js';
import { defaultRfd4Settings } from './runner.js';

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(text);
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

export function createApi({ store, tamarind, manager, version = '0.3.0' }) {
  return async function handleApi(req, res, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/')) return false;

    try {
      if (req.method === 'GET' && path === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          app: 'loopline',
          version,
          runtime: 'simulation',
          frontend: 'react-astryx',
          database: { driver: 'node:sqlite', ...store.stats() },
          tamarind: {
            configured: tamarind.configured,
            baseUrl: tamarind.baseUrl,
          },
        });
        return true;
      }

      if (req.method === 'GET' && path === '/api/projects') {
        sendJson(res, 200, { projects: store.listProjects(Number(url.searchParams.get('limit')) || 50) });
        return true;
      }

      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const id = decodeURIComponent(projectMatch[1]);
        if (req.method === 'GET') {
          const project = store.getProject(id);
          if (!project) return sendJson(res, 404, { error: 'Project not found' }), true;
          sendJson(res, 200, project);
          return true;
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const body = await readJson(req);
          if (!body.data || typeof body.data !== 'object') {
            sendJson(res, 400, { error: 'project.data must be an object' });
            return true;
          }
          const project = store.saveProject(id, body.name || body.data.name, body.data);
          sendJson(res, 200, project);
          return true;
        }
      }

      if (req.method === 'GET' && path === '/api/runs') {
        sendJson(res, 200, { runs: store.listRuns(Number(url.searchParams.get('limit')) || 50) });
        return true;
      }

      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && req.method === 'GET') {
        const run = store.getRunDetail(decodeURIComponent(runMatch[1]));
        if (!run) return sendJson(res, 404, { error: 'Run not found' }), true;
        sendJson(res, 200, run);
        return true;
      }

      const syncMatch = path.match(/^\/api\/runs\/([^/]+)\/sync$/);
      if (syncMatch && req.method === 'POST') {
        const run = await manager.syncRun(decodeURIComponent(syncMatch[1]));
        sendJson(res, 200, { run });
        return true;
      }

      const designMatch = path.match(/^\/api\/designs\/([^/]+)\/pdb$/);
      if (designMatch && req.method === 'GET') {
        const design = store.getDesign(decodeURIComponent(designMatch[1]));
        if (!design?.pdb) return sendJson(res, 404, { error: 'Design PDB not found' }), true;
        sendText(res, 200, design.pdb, 'chemical/x-pdb; charset=utf-8', {
          'content-disposition': `attachment; filename="${design.designId || 'design'}.pdb"`,
        });
        return true;
      }

      if (req.method === 'GET' && path === '/api/tamarind/jobs') {
        if (!tamarind.configured) {
          sendJson(res, 200, { configured: false, jobs: [], latestDesignJob: null, imported: [] });
          return true;
        }
        const limit = Number(url.searchParams.get('limit')) || 100;
        const { jobs, latest } = await manager.listTamarindJobs(limit, url.searchParams.get('refresh') === '1');
        const imported = store.listRuns(100)
          .filter((run) => run.jobName)
          .map((run) => ({ jobName: run.jobName, runId: run.id, status: run.status, designCount: run.designCount }));
        sendJson(res, 200, {
          configured: true,
          jobs,
          latestDesignJob: latest,
          imported,
          defaults: defaultRfd4Settings(latest),
          fetchedAt: new Date().toISOString(),
        });
        return true;
      }

      if (req.method === 'GET' && path === '/api/tamarind/config') {
        sendJson(res, 200, {
          configured: tamarind.configured,
          baseUrl: tamarind.baseUrl,
          jobType: 'rfd4-proteina',
        });
        return true;
      }

      if (req.method === 'POST' && path === '/api/tamarind/import-latest') {
        const result = await manager.importLatest();
        sendJson(res, 200, result);
        return true;
      }

      if (req.method === 'POST' && path === '/api/tamarind/import') {
        const body = await readJson(req);
        if (!body.jobName || typeof body.jobName !== 'string') {
          sendJson(res, 400, { error: 'jobName is required' });
          return true;
        }
        const run = await manager.importJob(body.jobName, 'manual-import');
        sendJson(res, 200, { imported: true, run });
        return true;
      }

      if (req.method === 'POST' && path === '/api/tamarind/validate') {
        const body = await readJson(req);
        const settings = body.settings && typeof body.settings === 'object' ? body.settings : defaultRfd4Settings();
        const validation = await manager.validateRfd4(settings);
        sendJson(res, 200, validation);
        return true;
      }

      if (req.method === 'POST' && path === '/api/tamarind/submit') {
        const body = await readJson(req);
        const settings = body.settings && typeof body.settings === 'object' ? body.settings : defaultRfd4Settings();
        const result = await manager.submitRfd4(settings, typeof body.jobName === 'string' ? body.jobName : undefined);
        sendJson(res, result.submitted ? 202 : 200, result);
        return true;
      }

      sendJson(res, 404, { error: `No API route for ${req.method} ${path}` });
      return true;
    } catch (error) {
      const status = error instanceof TamarindError ? (error.status || 502) : 500;
      sendJson(res, status, {
        error: error.message || 'Internal server error',
        ...(error instanceof TamarindError && error.body ? { detail: error.body } : {}),
      });
      return true;
    }
  };
}
