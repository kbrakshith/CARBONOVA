import { h, put, icon, fmt } from '../dom.js';
import { btn, tabs, status, dataTable, emptyState, stat, t, demoBanner } from '../ui.js';
import { S, api, recompute } from '../state.js';
import { orgUrl } from '../session.js';
import { stackedMonthChart, doughnutChart, barChart, COL, monthLabel } from '../chartjs.js';
import { ring } from '../charts.js';
import { openCalc } from '../calcdetail.js';
import { render as renderWaste } from './waste.js';

const TABS = [['summary', 'Summary'], ['s1', 'Scope 1'], ['s2', 'Scope 2'], ['s3', 'Scope 3'], ['waste', 'Waste and materials'], ['history', 'History']];

export async function render(root, go, query = {}) {
  const sm = S.summary;
  const res = sm.current?.result;
  const body = h('div');
  const active = TABS.some(([k]) => k === query.tab) ? query.tab : 'summary';
  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'My carbon footprint'), h('p', { class: 'sub' }, `Financial year ${sm.fy} (1 April to 31 March). Every figure can be traced to its records and calculation.`))),
    S.app.demo ? demoBanner() : null,
    tabs(TABS, active, (k) => { history.replaceState(null, '', `#footprint?tab=${k}`); draw(k); }), body);

  async function draw(k) {
    put(body, h('p', { class: 'muted' }, 'Loading...'));
    if (!res || !res.lines.length) { put(body, h('div', { class: 'card' }, emptyState({ icon: 'chart', title: 'No emissions calculated for this year', body: 'Add records in Activity Records, or choose another reporting period at the top.', action: btn('Go to records', { kind: 'primary', onclick: () => go('records') }) }))); if (k !== 'waste') return; }
    if (k === 'summary') return put(body, summary());
    if (k === 's1' || k === 's2') return put(body, scope(k === 's1' ? 1 : 2));
    if (k === 's3') return put(body, scope3());
    if (k === 'waste') { put(body); if (!S.out) await recompute(); return renderWaste(body, go); }
    if (k === 'history') return put(body, await historyTab());
  }

  const T = () => res.totals_t;
  const qualityPill = (l) => status(l.review_status === 'needs_review' ? 'needs_review' : l.data_quality);
  const lineLabel = (l) => l.waste_detail ? `${l.waste_detail.stream} (${l.waste_detail.route.replace(/_/g, ' ')})` : l.activity_id.startsWith('process:') ? `Process emission: ${l.activity_id.replace('process:', '')}` : (l.label ?? l.activity_id);
  const linesTable = (lines, empty) => {
    const tb = dataTable({ columns: [
      { key: 'label', label: 'Activity', sortable: true, sortValue: lineLabel, render: (l) => h('div', {}, h('b', {}, lineLabel(l)), h('div', { class: 'muted' }, l.method)) },
      { key: 'period', label: 'Period', sortable: true, sortValue: (l) => l.period.start, render: (l) => (l.period.start === l.period.end ? l.period.start : `${l.period.start.slice(0, 7)}`) },
      { key: 'quantity', label: 'Activity data', class: 'num', render: (l) => `${fmt(l.quantity, l.unit === 'kWh' || l.unit === 'L' ? 0 : 2)} ${l.unit}` },
      { key: 'factor_id', label: 'Factor', render: (l) => h('span', { class: 'muted' }, l.factor_id) },
      { key: 'q', label: 'Data quality', render: qualityPill },
      { key: 'co2eKg', label: 'tCO₂e', class: 'num', sortable: true, render: (l) => fmt(l.co2eKg / 1000, 3) },
      { key: 'x', label: '', render: (l) => btn('Inspect', { size: 'sm', ic: 'chart', onclick: () => openCalc(l) }) },
    ], rows: lines, sort: { key: 'co2eKg', dir: 'desc' }, pageSize: 8, empty: empty ?? h('p', { class: 'muted' }, 'No assessed figures here.') });
    tb.querySelector('table').classList.add('stack');
    return tb;
  };

  function summary() {
    const mon = sm.months; const last = mon.reduce((a, m, i) => (m.total > 0 ? i : a), -1);
    const measured = res.quality.measured_share ?? 0;
    const rows = [
      ['Scope 1 - direct', T().scope1_t, 'Fuel burned on site, process emissions, refrigerants and on-site waste treatment', 's1'],
      ['Scope 2 - purchased electricity', T().scope2_location_t, 'Location-based. Market-based figure: ' + t(T().scope2_market_t) + ' tCO₂e', 's2'],
      ['Scope 3 - assessed categories only', T().scope3_assessed_t, `${res.scope3_screening.filter((x) => x.status === 'calculated').length} of 15 categories assessed`, 's3'],
    ];
    return h('div', {},
      h('div', { class: 'metrics' }, stat('Total emissions', h('span', {}, t(T().scope1_2_3_assessed_t), h('small', {}, 'tCO₂e')), { sub: `FY ${sm.fy}` }), stat('Reporting period', `FY ${sm.fy}`, { sub: `${res.lines.length} calculated lines` }),
        stat('Scope 1 + 2', h('span', {}, t(T().scope1_2_location_t), h('small', {}, 'tCO₂e')), { sub: 'Core reporting figure' }), stat('Measured data', `${fmt(measured * 100, 0)}%`, { sub: 'of emissions from measured records' })),
      h('div', { class: 'card' }, h('h3', {}, 'Scope-wise breakdown'), h('div', { class: 'tablewrap' }, h('table', { class: 'stack' }, h('thead', {}, h('tr', {}, ['Scope', 'tCO₂e', 'What it covers', 'Status', ''].map((x, i) => h('th', { class: i === 1 ? 'num' : '' }, x)))),
        h('tbody', {}, rows.map(([n, v, d, k]) => h('tr', {}, h('td', { 'data-label': 'Scope' }, h('b', {}, n)), h('td', { class: 'num', 'data-label': 'tCO₂e' }, fmt(v, 2)), h('td', { class: 'muted', 'data-label': 'Covers' }, d),
          h('td', { 'data-label': 'Status' }, k === 's3' ? status('calculated', 'Partial inventory') : status(measured > 0.9 ? 'measured' : 'estimated', measured > 0.9 ? 'Mostly measured' : 'Mixed quality')), h('td', {}, btn('Details', { size: 'sm', onclick: () => go(`footprint?tab=${k}`) })))))))),
      h('div', { class: 'grid2' },
        h('section', { class: 'card' }, h('h3', {}, 'Monthly emissions by scope'), stackedMonthChart(mon, last), h('p', { class: 'chart-sum' }, `Bills and fuel records only. Annual items (waste, process emissions) total ${t(sm.annual_items_t)} tCO₂e and are not placed in a month.`)),
        h('section', { class: 'card' }, h('h3', {}, 'Where it comes from'), doughnutChart(sm.by_source.map((s, i) => ({ label: s.key, value: s.t, color: ['#103D32', '#238B62', '#4FAE86', '#7CC3A3', '#A9D9C2', '#D9A441', '#8E9C95', '#5C6F66'][i % 8] }))))),
      dataQuality());
  }

  function dataQuality() {
    const c = sm.completeness;
    const miss = Object.entries(c.missing).flatMap(([s, ms]) => ms.map((m) => ({ stream: s, month: m })));
    const pend = res.exclusions.filter((x) => /awaiting review/.test(x));
    return h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Data quality'), h('span', { class: 'muted' }, 'Each figure is measured, estimated, under review or missing. Nothing is silently zero.')),
      h('div', { class: 'row-tight', style: 'gap:24px;flex-wrap:wrap;align-items:flex-start' }, h('div', { style: 'text-align:center' }, ring(c.pct ?? 0, 'Completeness'), h('div', { class: 'muted' }, 'Records present')),
        h('div', { style: 'flex:1;min-width:240px' },
          h('p', {}, status('measured'), ` ${fmt((res.quality.measured_share ?? 0) * 100, 0)}% of emissions measured · `, status('estimated'), ` ${fmt((res.quality.estimated_share ?? 0) * 100, 0)}% estimated`),
          h('p', {}, status('needs_review'), ` ${pend.length + c.pending_documents} item(s) under review (${pend.length} records, ${c.pending_documents} documents)`),
          miss.length ? h('p', {}, status('missing'), ` ${miss.length} expected record(s) missing: `, miss.slice(0, 8).map((m) => `${m.stream} ${monthLabel(m.month + '-01')}`).join(', '), miss.length > 8 ? '…' : '') : h('p', {}, status('measured', 'No missing records'))),
      ));
  }

  function scope(n) {
    const lines = res.lines.filter((l) => l.scope === n);
    const groups = {};
    for (const l of lines) { const key = l.type === 'electricity' ? 'Purchased grid electricity' : l.type === 'refrigerant' ? 'Refrigerants' : l.type === 'waste' ? 'Waste treated on site' : l.type === 'process_emission' ? 'Process emissions' : `Fuel: ${(l.fuel ?? 'fuel').replace('_', ' ')}`; (groups[key] ??= []).push(l); }
    const total = lines.reduce((s, l) => s + l.co2eKg, 0) / 1000;
    return h('div', {}, h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, n === 1 ? 'Scope 1: direct emissions' : 'Scope 2: purchased electricity'), h('b', {}, `${t(total)} tCO₂e`)),
      h('p', { class: 'muted' }, n === 1 ? 'Diesel, petrol, LPG and other fuel burned in equipment you own or control, plus refrigerant leaks, process emissions and waste treated inside your boundary.' : 'Electricity imported from the grid. On-site solar is recorded separately and does not carry the grid factor. Market-based figures need documented renewable contracts.'),
      n === 2 && sm.current ? h('p', { class: 'msg info' }, 'India publishes no residual-mix factor, so market-based equals location-based unless you document renewable contracts. The grid factor covers CO₂ only.') : null),
      Object.keys(groups).length ? Object.entries(groups).map(([name, ls]) => h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, name), h('span', { class: 'muted' }, `${t(ls.reduce((s, l) => s + l.co2eKg, 0) / 1000)} tCO₂e · ${ls.length} line${ls.length > 1 ? 's' : ''}`)), linesTable(ls)))
        : h('div', { class: 'card' }, emptyState({ icon: 'chart', title: `No Scope ${n} figures`, body: 'Nothing has been recorded or approved for this scope in this period.' })));
  }

  function scope3() {
    const cats = res.scope3_screening;
    const lines = res.lines.filter((l) => l.scope === 3);
    return h('div', {}, h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, 'Scope 3 here is a partial inventory. Categories that are not assessed are not zero: they simply have no calculation yet.')),
      h('div', { class: 'card' }, h('h3', {}, 'Value-chain categories'), h('div', { class: 'tablewrap' }, h('table', { class: 'stack' }, h('thead', {}, h('tr', {}, ['#', 'Category', 'Status', 'tCO₂e'].map((x, i) => h('th', { class: i === 3 ? 'num' : '' }, x)))),
        h('tbody', {}, cats.map((c) => h('tr', {}, h('td', { 'data-label': '#' }, c.category), h('td', { 'data-label': 'Category' }, c.name, c.reason && c.status !== 'calculated' ? h('div', { class: 'muted' }, c.reason) : null), h('td', { 'data-label': 'Status' }, status(c.status)), h('td', { class: 'num', 'data-label': 'tCO₂e' }, c.co2e_t != null ? fmt(c.co2e_t, 3) : '—'))))))),
      h('div', { class: 'card' }, h('h3', {}, 'Assessed lines'), linesTable(lines, h('p', { class: 'muted' }, 'No Scope 3 lines yet. Add hired-transport fuel, waste sent to third parties or T&D losses.'))));
  }

  async function historyTab() {
    const fys = sm.fys;
    const data = await Promise.all(fys.map((fy) => (fy === sm.fy ? Promise.resolve(sm) : api('POST', orgUrl('/summary'), { fy }))));
    const rows = data.map((d) => ({ fy: d.fy, ...(d.current?.result.totals_t ?? {}), lines: d.current?.result.lines.length ?? 0, months: d.months.filter((m) => m.total > 0).length }));
    return h('div', {}, h('div', { class: 'card' }, h('h3', {}, 'Year on year'), barChart(rows.slice().reverse().map((r) => ({ label: `FY ${r.fy}`, value: r.scope1_2_3_assessed_t ?? 0, color: r.fy === sm.fy ? COL.s1 : COL.prev })), { unit: 'tCO₂e' }),
      h('p', { class: 'chart-sum' }, rows.some((r) => r.months < 12) ? 'Years with fewer than 12 months of records are partial and should not be compared with a full year. The Overview compares like-for-like months.' : 'All years have 12 months of records.')),
      h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('table', { class: 'stack' }, h('thead', {}, h('tr', {}, ['Financial year', 'Scope 1', 'Scope 2', 'Scope 3 (assessed)', 'Total', 'Months with data'].map((x, i) => h('th', { class: i && i < 5 ? 'num' : '' }, x)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { 'data-label': 'Year' }, `FY ${r.fy}`), h('td', { class: 'num', 'data-label': 'Scope 1' }, fmt(r.scope1_t, 1)), h('td', { class: 'num', 'data-label': 'Scope 2' }, fmt(r.scope2_location_t, 1)), h('td', { class: 'num', 'data-label': 'Scope 3' }, fmt(r.scope3_assessed_t, 1)), h('td', { class: 'num', 'data-label': 'Total' }, h('b', {}, fmt(r.scope1_2_3_assessed_t, 1))), h('td', { 'data-label': 'Months' }, `${r.months} of 12`))))))));
  }

  await draw(active);
}
