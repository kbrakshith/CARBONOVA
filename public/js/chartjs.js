// Chart.js wrappers. If the CDN script is unavailable every chart degrades to a table, so no figure is ever hidden.
import { h, fmt } from './dom.js';

export const COL = { s1: '#238B62', s2: '#103D32', s3: '#7CC3A3', prev: '#A9B7AF', amber: '#D9A441', muted: '#718078', grid: '#E1E9E4' };
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (k) => MN[Number(k.slice(5, 7)) - 1];

const live = new Set();
export const destroyCharts = () => { for (const c of live) c.destroy(); live.clear(); };

const rowsTable = (head, rows) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));

function chartBox(cls, makeConfig, fallback, label) {
  if (typeof window.Chart === 'undefined') return h('div', {}, h('p', { class: 'muted' }, 'Charts could not load (offline), so the figures are shown as a table.'), fallback);
  const host = h('div', { class: `chart ${cls ?? ''}` });
  const canvas = h('canvas', { role: 'img', 'aria-label': label });
  host.append(canvas);
  queueMicrotask(() => {
    const Chart = window.Chart;
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
    Chart.defaults.color = COL.muted;
    live.add(new Chart(canvas, makeConfig()));
  });
  return host;
}

const tip = (unit) => ({ callbacks: { label: (c) => ` ${c.dataset.label ?? c.label}: ${fmt(c.parsed.y ?? c.parsed.x ?? c.parsed, 2)} ${unit}` } });
const base = (unit) => ({ responsive: true, maintainAspectRatio: false, animation: { duration: 300 }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: tip(unit) }, interaction: { mode: 'index', intersect: false } });

/** Monthly line chart, current FY against the previous FY. Months after the last data month stay empty (not zero). */
export function trendChart(cur, prev, { curLabel, prevLabel, lastIdx }) {
  const labels = cur.map((m) => monthLabel(m.key));
  const curData = cur.map((m, i) => (i <= lastIdx ? +m.total.toFixed(3) : null));
  const prevData = prev?.length ? prev.map((m) => +m.total.toFixed(3)) : null;
  return chartBox('', () => ({ type: 'line', data: { labels, datasets: [
    { label: curLabel, data: curData, borderColor: COL.s1, backgroundColor: COL.s1, tension: 0.3, pointRadius: 3, spanGaps: false },
    ...(prevData ? [{ label: prevLabel, data: prevData, borderColor: COL.prev, backgroundColor: COL.prev, borderDash: [5, 4], tension: 0.3, pointRadius: 2 }] : []),
  ] }, options: { ...base('tCO2e'), scales: { y: { beginAtZero: true, title: { display: true, text: 'tCO2e per month' }, grid: { color: COL.grid } }, x: { grid: { display: false } } } } }),
  rowsTable(['Month', curLabel, prevLabel ?? ''], labels.map((l, i) => [l, curData[i] ?? '-', prevData?.[i] ?? '-'])), 'Monthly emissions, current and previous year');
}

export function stackedMonthChart(months, lastIdx) {
  const labels = months.map((m) => monthLabel(m.key));
  const ds = (k, label, color) => ({ label, data: months.map((m, i) => (i <= lastIdx ? +m[k].toFixed(3) : null)), backgroundColor: color, borderRadius: 3 });
  return chartBox('', () => ({ type: 'bar', data: { labels, datasets: [ds('s1', 'Scope 1', COL.s1), ds('s2', 'Scope 2', COL.s2), ds('s3', 'Scope 3', COL.s3)] },
    options: { ...base('tCO2e'), scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'tCO2e' }, grid: { color: COL.grid } } } } }),
  rowsTable(['Month', 'Scope 1', 'Scope 2', 'Scope 3'], months.map((m) => [monthLabel(m.key), m.s1.toFixed(2), m.s2.toFixed(2), m.s3.toFixed(2)])), 'Monthly emissions by scope');
}

export function doughnutChart(items, unit = 'tCO2e') {
  const nz = items.filter((i) => i.value > 0);
  const total = nz.reduce((s, i) => s + i.value, 0);
  const box = chartBox('sm', () => ({ type: 'doughnut', data: { labels: nz.map((i) => i.label), datasets: [{ data: nz.map((i) => +i.value.toFixed(3)), backgroundColor: nz.map((i) => i.color), borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', animation: { duration: 300 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed, 2)} ${unit} (${fmt((c.parsed / total) * 100, 1)}%)` } } } } }),
  rowsTable(['Item', unit], nz.map((i) => [i.label, i.value.toFixed(2)])), 'Distribution');
  return h('div', { class: 'donut-wrap' }, box, h('ul', { class: 'legend' }, nz.map((i) => h('li', {}, h('i', { style: `background:${i.color}` }), h('span', {}, i.label), h('b', {}, `${fmt(i.value, 1)} ${unit}`)))));
}

export function barChart(items, { horizontal = false, unit = 'tCO2e', color = COL.s1 } = {}) {
  return chartBox(horizontal ? '' : 'sm', () => ({ type: 'bar', data: { labels: items.map((i) => i.label), datasets: [{ label: unit, data: items.map((i) => +i.value.toFixed(3)), backgroundColor: items.map((i) => i.color ?? color), borderRadius: 4 }] },
    options: { ...base(unit), indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false }, tooltip: tip(unit) }, scales: { [horizontal ? 'x' : 'y']: { beginAtZero: true, title: { display: true, text: unit }, grid: { color: COL.grid } }, [horizontal ? 'y' : 'x']: { grid: { display: false } } } } }),
  rowsTable(['Item', unit], items.map((i) => [i.label, i.value.toFixed(2)])), 'Comparison');
}
