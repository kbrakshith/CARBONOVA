import { h, svg, fmt } from './dom.js';

// Colour tokens live in CSS custom properties so charts follow light/dark mode.
export const C = { s1: 'var(--c-s1)', s2: 'var(--c-s2)', s3: 'var(--c-s3)', haz: 'var(--c-haz)', waste: 'var(--c-waste)', prod: 'var(--c-prod)', gas: 'var(--c-gas)' };

/** Donut with centre total and an accessible legend table. */
export function donut(items, { size = 180, centre = '', unit = 't' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const r = 70, cx = 90, cy = 90, circ = 2 * Math.PI * r;
  let off = 0;
  const arcs = total > 0 ? items.filter((i) => i.value > 0).map((i) => {
    const len = (i.value / total) * circ;
    const a = svg('circle', { cx, cy, r, fill: 'none', stroke: i.color, 'stroke-width': 26, 'stroke-dasharray': `${len} ${circ - len}`, 'stroke-dashoffset': -off, transform: `rotate(-90 ${cx} ${cy})`, class: 'arc' },
      svg('title', {}, `${i.label}: ${fmt(i.value, 2)} ${unit} (${fmt((i.value / total) * 100, 1)}%)`));
    off += len;
    return a;
  }) : [svg('circle', { cx, cy, r, fill: 'none', stroke: 'var(--line)', 'stroke-width': 26 })];
  return h('div', { class: 'donut' },
    svg('svg', { viewBox: '0 0 180 180', width: size, height: size, role: 'img', 'aria-label': `Breakdown: ${items.map((i) => `${i.label} ${fmt(i.value, 1)} ${unit}`).join(', ')}` }, arcs,
      svg('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'dn-v' }, fmt(total, total >= 100 ? 0 : 1)), svg('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'dn-l' }, centre || unit)),
    h('ul', { class: 'legend' }, items.map((i) => h('li', {}, h('i', { style: `background:${i.color}` }), h('span', {}, i.label), h('b', {}, `${fmt(i.value, 1)} ${unit}`)))));
}

/** Horizontal ranked bars. */
export function hbars(items, { unit = 't', max } = {}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1e-9);
  return h('div', { class: 'hbars' }, items.length ? items.map((i) => h('div', { class: 'hb', title: i.title ?? '' },
    h('span', { class: 'hb-l' }, i.label), h('span', { class: 'hb-t' }, h('i', { style: `width:${Math.max((i.value / m) * 100, 1.5)}%;background:${i.color ?? C.s1}` })), h('b', {}, `${fmt(i.value, 1)} ${unit}`))) : h('p', { class: 'muted' }, 'No data yet.'));
}

/** Stacked monthly bars (Apr..Mar). `months` = [{key:'2026-04', s1, s2, s3}]. */
export function monthly(months, { height = 170 } = {}) {
  const W = 560, padL = 6, padB = 22, plotH = height - padB - 8;
  const max = Math.max(...months.map((m) => m.s1 + m.s2 + m.s3), 1e-9);
  const bw = (W - padL) / months.length;
  const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const bars = months.flatMap((m, i) => {
    let y = height - padB;
    const x = padL + i * bw + bw * 0.15, w = bw * 0.7;
    const segs = [['s1', C.s1, 'Scope 1'], ['s2', C.s2, 'Scope 2'], ['s3', C.s3, 'Scope 3']].map(([k, col, nm]) => {
      const hh = (m[k] / max) * plotH;
      y -= hh;
      return hh > 0 ? svg('rect', { x, y, width: w, height: hh, fill: col, rx: 2, class: 'mbar' }, svg('title', {}, `${m.key} ${nm}: ${fmt(m[k], 2)} t`)) : null;
    });
    return [...segs, svg('text', { x: x + w / 2, y: height - 6, 'text-anchor': 'middle', class: 'ax' }, NAMES[Number(m.key.slice(5)) - 1])];
  });
  return svg('svg', { viewBox: `0 0 ${W} ${height}`, class: 'monthly', role: 'img', 'aria-label': 'Monthly emissions by scope, tonnes CO2e' }, svg('line', { x1: padL, x2: W, y1: height - padB, y2: height - padB, stroke: 'var(--line)' }), bars);
}

/** Percentage ring. */
export function ring(pct, text, { size = 84 } = {}) {
  const r = 34, c = 2 * Math.PI * r, v = Math.min(Math.max(pct, 0), 1);
  return svg('svg', { viewBox: '0 0 84 84', width: size, height: size, role: 'img', 'aria-label': `${text}: ${fmt(v * 100, 0)}%` },
    svg('circle', { cx: 42, cy: 42, r, fill: 'none', stroke: 'var(--line)', 'stroke-width': 9 }),
    svg('circle', { cx: 42, cy: 42, r, fill: 'none', stroke: 'var(--c-s1)', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-dasharray': `${v * c} ${c}`, transform: 'rotate(-90 42 42)', class: 'arc' }),
    svg('text', { x: 42, y: 47, 'text-anchor': 'middle', class: 'ring-v' }, `${fmt(v * 100, 0)}%`));
}

/** Aggregate result lines into FY months (Apr..Mar). Annual items (waste, process) are returned separately. */
export function monthlySeries(result) {
  const [y] = result.reporting_fy.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; const yr = m >= 4 ? y : y + 1; return { key: `${yr}-${String(m).padStart(2, '0')}`, s1: 0, s2: 0, s3: 0 }; });
  let annual = 0;
  for (const l of result.lines) {
    if (l.type === 'waste' || l.type === 'process_emission' && String(l.activity_id).startsWith('process:')) { annual += l.co2eKg / 1000; continue; }
    const bucket = months.find((m) => m.key === l.period.start.slice(0, 7));
    if (bucket) bucket[`s${l.scope}`] += l.co2eKg / 1000; else annual += l.co2eKg / 1000;
  }
  return { months, annual };
}
