/* Dev-only headless Chrome driver (CDP) used for screenshots & smoke tests.
   Usage: node tools/cdp.mjs <scenario> [outfile] */

import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL = 'http://127.0.0.1:4173/';
const scenario = process.argv[2] || 'initial';
const output = process.argv[3] || join(process.cwd(), `shot-${scenario}.png`);
const profile = join(tmpdir(), `loopline-cdp-${Date.now()}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Chrome did not start');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        this.events.push(msg);
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails;
          console.error('PAGE EXCEPTION:', d.text, d.exception?.description || '');
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
          if (msg.params.type === 'error') console.error('CONSOLE ERROR:', text);
        }
      }
    };
    ws.onopen = () => this.opened?.();
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text + ' ' + (res.exceptionDetails.exception?.description || ''));
    }
    return res.result?.value;
  }
}

async function main() {
  await mkdir(join(process.cwd(), 'shots'), { recursive: true }).catch(() => {});
  const chrome = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--hide-scrollbars',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForChrome();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(2200);

    const fail = (msg) => { throw new Error(msg); };

    if (scenario === 'initial') {
      // default state
    } else if (scenario === 'render') {
      await cdp.evaluate('window.__loopline.app.render()');
      for (let i = 0; i < 50; i++) {
        await sleep(500);
        const rendering = await cdp.evaluate('window.__loopline.app.state.rendering');
        if (!rendering) break;
      }
      const state = await cdp.evaluate('({results: window.__loopline.app.state.results.length, tab: window.__loopline.app.state.tab, playhead: window.__loopline.app.state.playhead})');
      console.log('RENDER STATE', JSON.stringify(state));
      if (!state.results) fail('No results after render');
    } else if (scenario === 'flow') {
      await cdp.evaluate("window.__loopline.app.setView('flow')");
      await sleep(500);
    } else if (scenario === 'sequence') {
      await cdp.evaluate(`(() => {
        const app = window.__loopline.app;
        app.state.playhead = 12.5;
        app.engine.advance(12.5);
        app.refreshResults(true);
        app.setView('sequence');
        app.setTab('results');
      })()`);
      await sleep(700);
    } else if (scenario === 'clip') {
      await cdp.evaluate(`(() => {
        const app = window.__loopline.app;
        const clip = app.project.clips.find(c => c.modelId === 'rfdiffusion');
        app.state.selectedId = clip.id;
        app.state.playhead = 6.2;
        app.engine.advance(6.2);
        app.emit('selection');
        app.emit('playhead');
      })()`);
      await sleep(600);
    } else if (scenario === 'debug') {
      const info = await cdp.evaluate(`(() => {
        const m = window.__loopline.monitor;
        const r = m.canvas.getBoundingClientRect();
        return { w: m.w, h: m.h, dpr: m.dpr, rect: {x:r.x,y:r.y,w:r.width,h:r.height}, view: window.__loopline.app.state.view };
      })()`);
      console.log('DEBUG', JSON.stringify(info));
    } else if (scenario === 'eval') {
      const expr = process.argv[4] || 'document.body.innerText.slice(0,200)';
      const result = await cdp.evaluate(expr);
      console.log('EVAL', JSON.stringify(result));
    } else if (scenario === 'interact') {
      const report = await cdp.evaluate(`(() => {
        const app = window.__loopline.app;
        const out = { start: app.project.clips.length, valid: app.compile.valid };
        app.addClip('proteinmpnn', 3);
        out.afterAdd = app.project.clips.length;
        out.afterAddValid = app.compile.valid;
        app.undo();
        out.afterUndo = app.project.clips.length;
        const rfd = app.project.clips.find(c => c.modelId === 'rfdiffusion');
        app.moveClip(rfd.id, 5, 'backbone');
        out.afterMoveValid = app.compile.valid;
        out.afterMoveErrors = app.compile.errors.length;
        app.undo();
        out.afterUndoValid = app.compile.valid;
        app.duplicateClip(app.project.clips.find(c => c.modelId === 'proteinmpnn').id);
        out.afterDuplicate = app.project.clips.length;
        app.undo();
        app.applyTemplate('pdl1-proteina');
        out.templateClips = app.project.clips.length;
        out.templateValid = app.compile.valid;
        out.templateSeed = app.project.seed;
        return out;
      })()`);
      console.log('INTERACT', JSON.stringify(report));
      if (report.afterAdd !== report.start + 1) fail('addClip did not add');
      if (report.afterUndo !== report.start) fail('undo did not restore');
      if (report.afterMoveValid) fail('overlapping move should invalidate pipeline');
      if (!report.afterUndoValid) fail('undo did not restore a valid pipeline');
      if (!report.templateValid) fail('template pipeline invalid');
    } else if (scenario === 'mid') {
      await cdp.evaluate('window.__loopline.app.render()');
      await sleep(3400);
      const state = await cdp.evaluate('({playhead: window.__loopline.app.state.playhead, active: window.__loopline.app.preview().activeNode?.model?.name, rendering: window.__loopline.app.state.rendering})');
      console.log('MID', JSON.stringify(state));
    } else if (scenario === 'smoke') {
      const report = await cdp.evaluate(`(() => {
        const app = window.__loopline.app;
        const before = app.project.clips.length;
        app.render();
        return { before, valid: app.compile.valid, errors: app.compile.errors.length, duration: app.project.duration };
      })()`, true);
      console.log('SMOKE', JSON.stringify(report));
      await sleep(11500);
      const state = await cdp.evaluate('({playing: window.__loopline.app.state.playing, results: window.__loopline.app.state.results.length, tab: window.__loopline.app.state.tab, logs: window.__loopline.app.state.logs.length})');
      console.log('AFTER', JSON.stringify(state));
      if (!state.results) fail('Render produced no results');
      if (state.logs < 8) fail('Log stream incomplete');
    } else {
      fail(`Unknown scenario ${scenario}`);
    }

    await sleep(350);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(output, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT', output);
    ws.close();
  } finally {
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('FAILED', err.message);
  process.exitCode = 1;
});
