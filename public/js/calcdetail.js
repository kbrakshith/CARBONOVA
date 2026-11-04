// Calculation details: Activity data x Emission factor = Emissions, with the exact factor, source and gas basis.
import { h, fmt, icon } from './dom.js';
import { modal, status, btn } from './ui.js';
import { S, api } from './state.js';

const SCOPE = { 1: 'Scope 1 (direct)', 2: 'Scope 2 (purchased electricity)', 3: 'Scope 3 (value chain)' };
const box = (small, value, cls = '') => h('div', { class: `box ${cls}` }, h('small', {}, small), value);

export async function openCalc(line) {
  const gwp = S.summary?.current?.manifest.gwp ?? { values: {}, label: '' };
  let f = null;
  if (line.factor_id && !line.factor_id.startsWith('PROC-') && !line.factor_id.startsWith('GWP-') && line.factor_id !== 'IPCC2006-VOL5-DEFAULTS') f = await api('GET', `/api/factors/${line.factor_id}`).catch(() => null);
  const fm = S.summary?.current?.manifest.factors.find((x) => x.id === line.factor_id);
  const gases = Object.entries(line.gases ?? {}).filter(([, kg]) => kg !== 0);
  const co2Only = f?.gas_basis === 'CO2' && line.type === 'electricity';

  let formula;
  if (line.type === 'electricity') {
    formula = [box('Activity data', `${fmt(line.quantity, 0)} kWh grid import`), h('span', { class: 'op' }, '×'), box('Emission factor', `${f?.values?.CO2 ?? '?'} kg CO2 / kWh`), h('span', { class: 'op' }, '='), box('Result', `${fmt(line.co2eKg, 1)} kg CO2`, 'res')];
  } else if (line.type === 'fuel') {
    formula = [box('Activity data', line.quantity_basis ?? `${line.quantity} ${line.unit}`), h('span', { class: 'op' }, '×'), box('IPCC 2006 gas factors', f ? Object.entries(f.ef_kg_per_tj).map(([g, v]) => `${g} ${fmt(v, 1)}`).join(' · ') + ' kg/TJ' : '-'), h('span', { class: 'op' }, '='), box('Result (CO2e)', `${fmt(line.co2eKg, 1)} kg`, 'res')];
  } else {
    formula = [box('Activity data', `${fmt(line.quantity, 2)} ${line.unit}`), h('span', { class: 'op' }, '→'), box('Method', line.method?.slice(0, 80) ?? ''), h('span', { class: 'op' }, '='), box('Result (CO2e)', `${fmt(line.co2eKg, 1)} kg`, 'res')];
  }

  modal({
    title: `Calculation: ${line.label ?? line.activity_id}`, size: 'lg',
    body: [
      h('div', { class: 'row-tight', style: 'flex-wrap:wrap' }, status(line.data_quality), h('span', { class: 'pill neutral' }, SCOPE[line.scope] + (line.scope3_category ? ` · category ${line.scope3_category}` : '')), f ? status(f.status) : fm ? status(fm.status) : null),
      h('div', { class: 'formula', 'aria-label': 'Calculation formula' }, ...formula),
      co2Only ? h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, 'Simplified CO2 estimate: this grid factor covers CO2 only. CH4 and N2O from power generation are not included, and this is stated in every report.')) : null,
      f?.status === 'provisional' || fm?.status === 'provisional' ? h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, 'Provisional factor: not yet checked against the original table by a named reviewer. Reports using it cannot be marked reviewed or assured.')) : null,
      h('h4', {}, 'Gas by gas'),
      h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Gas', 'Amount (kg)', `GWP (${S.summary?.current?.manifest.gwp.set ?? ''})`, 'kg CO2e'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
        h('tbody', {}, gases.map(([g, kg]) => h('tr', {}, h('td', {}, g), h('td', { class: 'num' }, fmt(kg, 3)), h('td', { class: 'num' }, gwp.values[g] ?? '-'), h('td', { class: 'num' }, fmt(kg * (gwp.values[g] ?? 1), 2)))),
          h('tr', {}, h('th', {}, 'Total'), h('th', {}), h('th', {}), h('th', { class: 'num' }, fmt(line.co2eKg, 2)))))),
      h('h4', { style: 'margin-top:16px' }, 'Where the numbers come from'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Factor'), h('dd', {}, line.factor_id ?? '-'),
        h('dt', {}, 'Source'), h('dd', {}, f ? `${f.source.document} - ${f.source.table}` : fm ? `${fm.document} - ${fm.table}` : (line.method ?? '-')),
        h('dt', {}, 'Version / published'), h('dd', {}, f?.source.published ?? fm?.version ?? '-'),
        h('dt', {}, 'Applicable period'), h('dd', {}, f ? `${f.valid_from} to ${f.valid_to ?? 'open'}` : '-'),
        h('dt', {}, 'Gas basis'), h('dd', {}, f?.gas_basis ?? '-'),
        h('dt', {}, 'Method'), h('dd', {}, f?.methodology ?? line.method ?? '-'),
        h('dt', {}, 'GWP set'), h('dd', {}, gwp.label),
        h('dt', {}, 'Period'), h('dd', {}, `${line.period.start} to ${line.period.end}`),
        h('dt', {}, 'Evidence'), h('dd', {}, line.evidence_id ?? 'none attached')),
      ...(line.warnings ?? []).map((w) => h('p', { class: 'msg warning' }, w.message)),
    ],
    footer: [h('span', { class: 'muted', style: 'margin-right:auto' }, 'Deterministic calculation. No AI is used for any figure.'), btn('Close', { onclick: (e) => e.target.closest('dialog').querySelector('.icon-btn').click() })],
  });
}
