// Small DOM toolkit. Everything goes through textContent / createElementNS: no innerHTML, so
// server-supplied strings can never inject markup.

export const $ = (sel, root = document) => root.querySelector(sel);
const SVG_NS = 'http://www.w3.org/2000/svg';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function build(el, attrs, kids) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'value' && !(el instanceof SVGElement)) el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
export const svg = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);

/** Replace an element's children, flattening arrays and skipping null/false (native replaceChildren would print "null"). */
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  return el;
}

/** Append children, flattening arrays and skipping null/false (native append would print "null"). */
export function add(el, ...kids) {
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  return el;
}

export const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? '-' : Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtT = (x) => (x == null ? '-' : Math.abs(x) >= 100 ? fmt(x, 0) : Math.abs(x) >= 10 ? fmt(x, 1) : fmt(x, 2));
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Animate a number inside `el` from its current value to `to`. Respects reduced-motion. */
export function countUp(el, to, { digits = 1, suffix = '', ms = 700 } = {}) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  const paint = (v) => { el.textContent = fmt(v, digits) + suffix; };
  if (reduceMotion() || from === to) return paint(to);
  const t0 = performance.now();
  setTimeout(() => { if (Number(el.dataset.v) === to) paint(to); }, ms + 60); // background tabs do not run animation frames
  const step = (t) => {
    const k = Math.min((t - t0) / ms, 1);
    paint(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1 && Number(el.dataset.v) === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'err' ? 7000 : 3500);
}

export const label = (text, input, hint) => h('label', {}, h('span', { class: 'lbl' }, text), input, hint ? h('span', { class: 'hint' }, hint) : null);
export const field = (text, attrs, hint) => label(text, h('input', attrs), hint);
export const select = (opts, value, attrs = {}) => h('select', attrs, opts.map(([v, t]) => h('option', { value: v, selected: v === value ? true : null }, t)));
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
const ICONS = {
  home: 'M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.4 5.5-7',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  chart: 'M3 3v18h18M7 16v-5M12 16V7M17 16v-8',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  building: 'M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 7h3M8 11h3M8 15h3',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  settings: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14', upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 20h16', download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  x: 'M18 6 6 18M6 6l12 12', check: 'M20 6 9 17l-5-5', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  down: 'M6 9l6 6 6-6', left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6', collapse: 'M11 17l-5-5 5-5M18 17l-5-5 5-5', menu: 'M3 6h18M3 12h18M3 18h18',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  copy: 'M8 8h12v12H8zM4 16V4h12', flow: 'M3 6h6l3 6h9M3 18h6l3-6', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4', doc: 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
};
export const icon = (name, size = 18) => svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' }, svg('path', { d: ICONS[name] ?? ICONS.leaf }));
