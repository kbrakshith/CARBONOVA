import { h, put, icon, fmt, add } from '../dom.js';
import { btn, stat, t, status, emptyState, demoBanner } from '../ui.js';
import { S, api } from '../state.js';
import { orgUrl } from '../session.js';
import { trendChart, doughnutChart, barChart, COL, monthLabel } from '../chartjs.js';
import { openRecordForm } from '../recordform.js';

const SRC_COL = { Electricity: '#103D32', Diesel: '#238B62', Petrol: '#4FAE86', LPG: '#7CC3A3', Transport: '#A9D9C2', Waste: '#D9A441', Refrigerants: '#8E9C95', Process: '#5C6F66', 'Other fuels': '#B8C4BD' };

export async function render(root, go) {
  const sm = S.summary;
  const cur = sm.current?.result;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const org = S.org.inventory.organisation;

  add(root, 
    h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, `${greet}, ${org.legal_name}`), h('p', { class: 'sub' }, "Here's an overview of your business's environmental performance.")),
      h('div', { class: 'head-actions' }, btn('Add activity', { kind: 'primary', ic: 'plus', onclick: () => openRecordForm({ onSaved: () => go('overview', true) }) }), btn('Upload document', { ic: 'upload', onclick: () => go('documents') }), btn('Generate report', { ic: 'file', onclick: () => go('reports?new=1') }))),
    S.app.demo ? demoBanner() : null);

  if (!cur || !cur.lines.length) {
    add(root, h('div', { class: 'card' }, emptyState({ icon: 'leaf', title: 'No emissions calculated yet', body: 'Add your first electricity bill or fuel record and your footprint appears here.', action: btn('Add activity', { kind: 'primary', ic: 'plus', onclick: () => openRecordForm({ onSaved: () => go('overview', true) }) }) })));
    return;
  }
  const T = cur.totals_t;
  const cmp = sm.comparison;
  const pct = cmp?.change_pct;
  const comp = sm.completeness;

  add(root, h('div', { class: 'metrics', role: 'group', 'aria-label': 'Key figures' },
    stat('Total emissions', h('span', {}, t(T.scope1_2_3_assessed_t), h('small', {}, 'tCO₂e')), {
      sub: pct != null ? `${pct <= 0 ? '▼' : '▲'} ${fmt(Math.abs(pct), 1)}% vs same months last year (to ${monthLabel(cmp.to_month)})` : `FY ${sm.fy}, assessed categories`, tone: pct != null ? (pct <= 0 ? 'good' : 'bad') : '' }),
    stat('Scope 1 emissions', h('span', {}, t(T.scope1_t), h('small', {}, 'tCO₂e')), { sub: 'Fuel, process and on-site waste treatment' }),
    stat('Scope 2 emissions', h('span', {}, t(T.scope2_location_t), h('small', {}, 'tCO₂e')), { sub: 'Purchased electricity (location-based)' }),
    stat('Data completeness', comp.pct == null ? '-' : `${fmt(comp.pct * 100, 0)}%`, { sub: `${comp.pending_documents + comp.pending_records} item(s) pending review` })));

  // ---- trend + sources
  const lastIdx = sm.months.reduce((a, m, i) => (m.total > 0 ? i : a), -1);
  const trendHost = h('div');
  const incomplete = [...new Set(Object.values(sm.completeness.missing).flat())].sort();
  const incompleteNote = incomplete.length ? ` Incomplete months: ${incomplete.map((k) => monthLabel(k + '-01')).join(', ')} (an expected bill or fuel record is missing, so that month is understated).` : '';
  const drawTrend = (range) => {
    const from = range === '6' ? Math.max(lastIdx - 5, 0) : 0;
    put(trendHost, trendChart(sm.months.slice(from), sm.previous_months?.slice(from), { curLabel: `FY ${sm.fy}`, prevLabel: sm.previous_fy ? `FY ${sm.previous_fy}` : null, lastIdx: lastIdx - from }),
      h('p', { class: 'chart-sum' }, cmp ? `Monthly emissions from bills and fuel records: ${t(cmp.current_t)} tCO₂e so far this year against ${t(cmp.previous_t)} tCO₂e in the same months last year (${pct <= 0 ? 'down' : 'up'} ${fmt(Math.abs(pct), 1)}%). Waste and process emissions (${t(sm.annual_items_t)} tCO₂e) are annual items and are not placed in a month.${incompleteNote}` : `${t(T.scope1_2_3_assessed_t)} tCO₂e so far. No earlier year to compare yet.${incompleteNote}`));
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' }, [['all', 'Full year'], ['6', 'Last 6 months']].map(([k, l], i) => h('button', { type: 'button', class: i === 0 ? 'on' : '', onclick: (e) => { seg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); drawTrend(k); } }, l)));
  drawTrend('all');
  const srcItems = sm.by_source.map((s) => ({ label: s.key, value: s.t, color: SRC_COL[s.key] ?? COL.prev }));

  add(root, h('div', { class: 'grid2 w' },
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Emissions trend'), seg), trendHost),
    h('section', { class: 'card' }, h('h3', {}, 'Emissions by source'), barChart(srcItems.slice(0, 7), { horizontal: true }),
      h('p', { class: 'chart-sum' }, `${srcItems[0].label} is the largest source at ${fmt((srcItems[0].value / T.scope1_2_3_assessed_t) * 100, 0)}% of the total.`))));

  // ---- scope distribution + action required
  const todo = [];
  if (comp.pending_documents) todo.push({ tone: 'warn', text: `${comp.pending_documents} document${comp.pending_documents > 1 ? 's' : ''} waiting for review`, to: 'documents', cta: 'Review' });
  for (const [stream, months] of Object.entries(comp.missing)) if (months.length) todo.push({ tone: 'warn', text: `Missing ${stream.toLowerCase()} record${months.length > 1 ? 's' : ''}: ${months.map(monthLabel).join(', ')}`, to: 'records', cta: 'Add' });
  if (comp.pending_records) todo.push({ tone: 'warn', text: `${comp.pending_records} record(s) not yet approved and left out of totals`, to: 'records', cta: 'Open' });
  if (sm.waste_brief?.streams_to_measure) todo.push({ tone: 'info', text: `${sm.waste_brief.streams_to_measure} waste stream(s) need a measured quantity`, to: 'footprint?tab=waste', cta: 'Open' });
  if (!todo.length) todo.push({ tone: 'ok', text: 'Nothing needs your attention.', to: null });

  const s3 = cur.scope3_screening.filter((x) => x.status === 'calculated').length;
  add(root, h('div', { class: 'grid2' },
    h('section', { class: 'card' }, h('h3', {}, 'Scope distribution'),
      doughnutChart([{ label: 'Scope 1 - direct', value: T.scope1_t, color: COL.s1 }, { label: 'Scope 2 - electricity', value: T.scope2_location_t, color: COL.s2 }, { label: 'Scope 3 - assessed only', value: T.scope3_assessed_t, color: COL.s3 }]),
      h('p', { class: 'chart-sum' }, `Scope 3 includes ${s3} of 15 categories. The other categories are not assessed, which is different from zero.`)),
    h('section', { class: 'card' }, h('h3', {}, 'Action required'), h('ul', { class: 'list todo' }, todo.map((x) => h('li', {}, h('span', { class: `dotmark ${x.tone}` }), h('div', { class: 'grow-1' }, x.text), x.to ? btn(x.cta, { size: 'sm', onclick: () => go(x.to) }) : null))))));

  // ---- recent activity + reduction opportunities (loaded after first paint)
  const feedHost = h('div', {}, h('p', { class: 'muted' }, 'Loading...'));
  const recHost = h('div', {}, h('p', { class: 'muted' }, 'Loading...'));
  add(root, h('div', { class: 'grid2' },
    h('section', { class: 'card' }, h('h3', {}, 'Recent activity'), feedHost),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Reduction opportunities'), btn('Open planner', { size: 'sm', onclick: () => go('planner') })), recHost)));

  api('GET', orgUrl('/feed')).then((r) => put(feedHost, r.feed.length ? h('ul', { class: 'list' }, r.feed.slice(0, 6).map((e) => h('li', {}, h('span', { class: 'dotmark ok' }), h('div', { class: 'grow-1' }, e.text, e.detail ? h('span', { class: 'muted' }, ` · ${e.detail}`) : null), h('span', { class: 'muted' }, new Date(e.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))))) : h('p', { class: 'muted' }, 'Nothing yet.'))).catch(() => put(feedHost, h('p', { class: 'muted' }, 'Could not load activity.')));
  api('POST', orgUrl('/recommendations'), {}).then((r) => put(recHost, r.actions.length ? h('ul', { class: 'list' }, r.actions.slice(0, 3).map((a) => h('li', {}, h('span', { class: 'dotmark ok' }), h('div', { class: 'grow-1' }, h('b', {}, a.title), h('div', { class: 'muted' }, a.annual_tco2e_avoided > 0 ? `${t(a.annual_tco2e_avoided)} tCO₂e avoided per year` : a.diverted_t ? `${t(a.diverted_t)} t diverted from disposal` : 'Saving depends on your quotes'), a.payback_years != null ? h('div', { class: 'muted' }, `Payback about ${fmt(a.payback_years, 1)} years (assumption-based)`) : null)))) : h('p', { class: 'muted' }, 'Add more data to see opportunities.'))).catch(() => put(recHost, h('p', { class: 'muted' }, 'Could not load recommendations.')));
  void icon; void status;
}
