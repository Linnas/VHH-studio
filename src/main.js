/* App shell: top bar, transport, logs, toasts and global shortcuts. */

import { App } from './state.js';
import { Library } from './ui/library.js';
import { Timeline } from './ui/timeline.js';
import { Monitor } from './ui/monitor.js';
import { Inspector } from './ui/inspector.js';
import { qs, qsa } from './ui/dom.js';
import { formatTimecode } from './engine/rng.js';

const app = new App();
const library = new Library(app);
const timeline = new Timeline(app);
const monitor = new Monitor(app);
const inspector = new Inspector(app);

/* --------------------------------- top bar --------------------------------- */
const projectName = qs('#projectName');
const undoBtn = qs('#undoBtn');
const redoBtn = qs('#redoBtn');
const exportBtn = qs('#exportBtn');
const exportMenu = qs('#exportMenu');
const renderBtn = qs('#renderBtn');
const renderLabel = qs('#renderLabel');
const saveState = qs('#saveState');

projectName.value = app.project.name;
projectName.addEventListener('change', () => app.renameProject(projectName.value));
projectName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') projectName.blur();
});
undoBtn.addEventListener('click', () => app.undo());
redoBtn.addEventListener('click', () => app.redo());
renderBtn.addEventListener('click', () => {
  if (app.state.rendering) app.cancelRender();
  else app.render();
});

exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
});
exportMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-export]');
  if (!item) return;
  app.export(item.dataset.export);
  exportMenu.hidden = true;
});
document.addEventListener('click', (e) => {
  if (!exportMenu.hidden && !e.target.closest('.menu-wrap')) exportMenu.hidden = true;
});

/* --------------------------------- stage ----------------------------------- */
const viewTabs = qs('#viewTabs');
const stageMeta = qs('#stageMeta');
const spinBtn = qs('#spinBtn');
const labelBtn = qs('#labelBtn');
const resetViewBtn = qs('#resetViewBtn');

viewTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (btn) app.setView(btn.dataset.view);
});
spinBtn.addEventListener('click', () => app.toggleSpin());
labelBtn.addEventListener('click', () => app.toggleLabels());
resetViewBtn.addEventListener('click', () => monitor.resetCamera());

function updateViewUI() {
  for (const btn of viewTabs.querySelectorAll('[data-view]')) {
    btn.classList.toggle('active', btn.dataset.view === app.state.view);
  }
  spinBtn.classList.toggle('active', app.state.spin);
  labelBtn.classList.toggle('active', app.state.labels);
  spinBtn.disabled = app.state.view !== '3d';
  labelBtn.disabled = app.state.view !== '3d';
}

/* --------------------------------- timeline -------------------------------- */
const playBtn = qs('#playBtn');
const playIcon = qs('#playIcon');
const toStartBtn = qs('#toStartBtn');
const toEndBtn = qs('#toEndBtn');
const tcCur = qs('#tcCur');
const tcTotal = qs('#tcTotal');
const monitorTc = qs('#monitorTc');
const rateGroup = qs('#rateGroup');
const snapBtn = qs('#snapBtn');
const zoomRange = qs('#zoomRange');
const fitBtn = qs('#fitBtn');
const logsBtn = qs('#logsBtn');
const logsDrawer = qs('#logsDrawer');
const logsBody = qs('#logsBody');
const logsSub = qs('#logsSub');
const logCount = qs('#logCount');
const logLed = qs('#logLed');
const closeLogsBtn = qs('#closeLogsBtn');
const clearLogsBtn = qs('#clearLogsBtn');
const resultCount = qs('#resultCount');
const toastStack = qs('#toastStack');

playBtn.addEventListener('click', () => app.togglePlay());
toStartBtn.addEventListener('click', () => app.setPlayhead(0, { user: true }));
toEndBtn.addEventListener('click', () => app.setPlayhead(app.project.duration, { user: true }));

rateGroup.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rate]');
  if (btn) app.setSpeed(Number(btn.dataset.rate));
});
snapBtn.addEventListener('click', () => app.toggleSnap());
zoomRange.value = String(app.state.zoom);
zoomRange.addEventListener('input', () => app.setZoom(Number(zoomRange.value)));
fitBtn.addEventListener('click', () => timeline.fit());
logsBtn.addEventListener('click', () => app.toggleLogs());
closeLogsBtn.addEventListener('click', () => app.toggleLogs(false));
clearLogsBtn.addEventListener('click', () => {
  app.state.logs = [];
  app.log('Log cleared', 'sys');
});

function updateTimecodes() {
  const text = formatTimecode(app.state.playhead, app.project.fps);
  tcCur.textContent = text;
  tcTotal.textContent = formatTimecode(app.project.duration, app.project.fps);
  monitorTc.textContent = text;
  if (app.state.rendering) {
    const pct = Math.round((app.state.playhead / Math.max(0.01, app.project.duration)) * 100);
    renderLabel.textContent = `Rendering ${pct}%`;
  }
}

function updateTransport() {
  const playing = app.state.playing;
  playIcon.innerHTML = `<use href="#i-${playing ? 'pause' : 'play'}"/>`;
  playBtn.classList.toggle('playing', playing);
  playBtn.title = playing ? 'Pause (Space)' : 'Play (Space)';
  renderBtn.classList.toggle('busy', app.state.rendering);
  renderBtn.title = app.state.rendering ? 'Cancel render' : 'Render timeline (Ctrl/Cmd+Enter)';
  if (!app.state.rendering) renderLabel.textContent = 'Render';
  updateTimecodes();
}

function updateHistory() {
  undoBtn.disabled = app.history.length === 0;
  redoBtn.disabled = app.future.length === 0;
}

function updateMeta() {
  const c = app.compile;
  const clips = c.nodes.filter((n) => n.model).length;
  const err = c.errors.length;
  const warn = c.warnings.length;
  stageMeta.innerHTML = `
    <span class="${err ? 'bad' : 'ok'}">● ${err ? `${err} error${err > 1 ? 's' : ''}` : 'pipeline ready'}</span>
    <span style="color:#2b3746">/</span>
    <span>${clips} clips</span>
    <span style="color:#2b3746">·</span>
    <span>${c.edges.length} edges</span>
    ${warn ? `<span style="color:#c9a86c">· ${warn} warn</span>` : ''}`;
  renderBtn.disabled = false;
}

function updateSpeed() {
  for (const btn of rateGroup.querySelectorAll('[data-rate]')) {
    btn.classList.toggle('active', Number(btn.dataset.rate) === app.state.speed);
  }
}

function updateSaved(state) {
  saveState.textContent = state === 'error' ? 'save failed' : 'saved';
  saveState.classList.toggle('dirty', state === 'error');
}

/* ---------------------------------- logs ---------------------------------- */
function renderLogs() {
  const logs = app.state.logs;
  logCount.textContent = String(Math.min(999, logs.length));
  logLed.classList.toggle('on', logs.length > 0 && !app.state.logsOpen);
  logsSub.textContent = app.state.logsOpen ? 'streaming' : `${logs.length} entries`;
  logsBody.innerHTML = logs.map((l) => `
    <div class="log-line ${l.level}">
      <span class="lt">${l.t}</span>
      <span class="lm">${escapeText(l.msg)}</span>
    </div>`).join('');
  if (app.state.logsOpen) logsBody.scrollTop = logsBody.scrollHeight;
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateLogsDrawer() {
  logsDrawer.classList.toggle('open', app.state.logsOpen);
  logsBtn.classList.toggle('active', app.state.logsOpen);
  renderLogs();
}

/* --------------------------------- toasts --------------------------------- */
function showToast({ message, kind }) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="t-dot"></span><span>${escapeText(message)}</span>`;
  toastStack.appendChild(el);
  while (toastStack.children.length > 4) toastStack.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, 3200);
}

/* --------------------------------- events --------------------------------- */
app.on('project', () => {
  if (document.activeElement !== projectName) projectName.value = app.project.name;
  document.title = `${app.project.name} · Loopline`;
  updateMeta();
  updateHistory();
  updateTimecodes();
  updateViewUI();
});
app.on('playhead', updateTimecodes);
app.on('tick', updateTimecodes);
app.on('transport', updateTransport);
app.on('render', updateTransport);
app.on('speed', updateSpeed);
app.on('view', updateViewUI);
app.on('snap', () => snapBtn.classList.toggle('active', app.state.snap));
app.on('history', updateHistory);
app.on('save', updateSaved);
app.on('logs', () => {
  updateLogsDrawer();
});
app.on('results', () => {
  resultCount.textContent = String(app.state.results.length);
});
app.on('toast', showToast);
app.on('selection', () => {
  if (app.state.selectedId && app.state.tab === 'results') app.setTab('inspector');
});

/* -------------------------------- shortcuts ------------------------------- */
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key === 'Enter') {
    e.preventDefault();
    if (app.state.rendering) app.cancelRender();
    else app.render();
    return;
  }
  if (mod && e.key.toLowerCase() === 'z') {
    if (typing) return;
    e.preventDefault();
    if (e.shiftKey) app.redo();
    else app.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    if (typing) return;
    e.preventDefault();
    app.redo();
    return;
  }
  if (typing) {
    if (e.key === 'Escape') document.activeElement.blur();
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
  } else if (e.key === 'Escape') {
    exportMenu.hidden = true;
    app.state.selectedId = null;
    app.emit('selection');
  }
});

window.addEventListener('beforeunload', () => {
  app.save();
});

/* ---------------------------------- boot ---------------------------------- */
updateMeta();
updateHistory();
updateTransport();
updateViewUI();
updateSpeed();
updateSaved('saved');
snapBtn.classList.toggle('active', app.state.snap);
updateLogsDrawer();
resultCount.textContent = String(app.state.results.length);
app.emit('tab');
document.title = `${app.project.name} · Loopline`;
app.state.zoom = Math.max(app.state.zoom, Math.min(72, Math.round((timeline.scrollEl.clientWidth - 18) / Math.max(1, app.project.duration))));
zoomRange.value = String(app.state.zoom);
timeline.layout();

if (!localStorage.getItem('loopline.project.v1')) {
  app.log('Welcome · demo timeline loaded. Drag a model, press Space, or hit Render.', 'sys');
}

// Expose a tiny debug surface for automated checks.
window.__loopline = { app, timeline, monitor, inspector, library };
