export const icon = (name, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#${name}"/></svg>`;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function qs(sel, root = document) {
  return root.querySelector(sel);
}

export function qsa(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (!target || !root.contains(target)) return;
    handler(e, target);
  });
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = performance.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = performance.now();
        fn(...args);
      }, wait);
    }
  };
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function fmtNumber(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}
