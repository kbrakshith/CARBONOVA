import { h, put, icon, fmt, debounce } from '../dom.js';
import { btn, dataTable, status, modal, select, emptyState } from '../ui.js';
import { S, api } from '../state.js';

export async function render(root) {
  const reg = await api('GET', '/api/factors');
  const used = new Set(S.summary?.current?.manifest.factors.map((f) => f.id) ?? []);
  const f = { q: '', status: '', kind: '' };
  const KIND = { grid_electricity: 'Grid electricity', fuel: 'Fuel combustion' };

  const detail = (x) => {
    const gases = x.values ? Object.entries(x.values).map(([g, v]) => `${g} ${v} kg per ${x.unit}`).join(' · ') : Object.entries(x.ef_kg_per_tj).map(([g, v]) => `${g} ${fmt(v, 1)} kg/TJ`).join(' · ');
    const m = modal({ title: x.id, size: 'md', body: [
      x.status === 'provisional' ? h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, 'Provisional: not yet checked against the original table by a named reviewer. Reports using it cannot be marked reviewed or assured.')) : null,
      h('dl', { class: 'kv' }, h('dt', {}, 'Activity'), h('dd', {}, x.activity), h('dt', {}, 'Values'), h('dd', {}, gases), x.ncv_gj_per_t ? [h('dt', {}, 'Net calorific value'), h('dd', {}, `${x.ncv_gj_per_t} GJ/t`)] : null,
        x.density_kg_per_l ? [h('dt', {}, 'Density'), h('dd', {}, `${x.density_kg_per_l} kg/L (assumption: override with your supplier's value)`)] : null,
        h('dt', {}, 'Gas basis'), h('dd', {}, x.gas_basis), h('dt', {}, 'Geography'), h('dd', {}, x.geography), h('dt', {}, 'Source document'), h('dd', {}, x.source.document), h('dt', {}, 'Table'), h('dd', {}, x.source.table), h('dt', {}, 'Published'), h('dd', {}, x.source.published ?? '-'),
        h('dt', {}, 'Applicable period'), h('dd', {}, `${x.valid_from} to ${x.valid_to ?? 'open'}`), h('dt', {}, 'Methodology'), h('dd', {}, x.methodology), x.notes ? [h('dt', {}, 'Notes'), h('dd', {}, x.notes)] : null,
        h('dt', {}, 'Reviewer'), h('dd', {}, x.reviewer ? `${x.reviewer} on ${x.reviewed_on}` : 'Not reviewed yet'), h('dt', {}, 'Used in this report'), h('dd', {}, used.has(x.id) ? 'Yes' : 'No'),
        x.source.url ? [h('dt', {}, 'Original'), h('dd', {}, h('a', { href: x.source.url, target: '_blank', rel: 'noopener' }, x.source.url))] : null)],
    footer: [btn('Close', { onclick: () => m.close() })] });
  };

  const table = dataTable({ columns: [
    { key: 'id', label: 'Factor', sortable: true, render: (x) => h('div', {}, h('b', {}, x.activity), h('div', { class: 'muted' }, x.id)) },
    { key: 'kind', label: 'Type', sortable: true, render: (x) => KIND[x.kind] ?? x.kind },
    { key: 'source', label: 'Source', render: (x) => h('span', { class: 'muted' }, `${x.source.document}`) },
    { key: 'gas_basis', label: 'Gas basis', render: (x) => x.gas_basis },
    { key: 'valid_from', label: 'Valid', render: (x) => `${x.valid_from.slice(0, 4)} to ${x.valid_to ? x.valid_to.slice(0, 4) : 'open'}` },
    { key: 'status', label: 'Status', sortable: true, render: (x) => status(x.status) },
    { key: 'u', label: 'In use', render: (x) => (used.has(x.id) ? status('calculated', 'Used') : '') },
    { key: 'a', label: '', render: (x) => btn('Details', { size: 'sm', ic: 'eye', onclick: () => detail(x) }) },
  ], rows: reg.factors, pageSize: 12, sort: { key: 'kind', dir: 'asc' }, caption: 'Emission factors', empty: emptyState({ icon: 'search', title: 'No factors match' }) });
  table.querySelector('table').classList.add('stack');
  const apply = () => { const q = f.q.toLowerCase(); table.update(reg.factors.filter((x) => (!q || `${x.id} ${x.activity} ${x.source.document}`.toLowerCase().includes(q)) && (!f.status || x.status === f.status) && (!f.kind || x.kind === f.kind))); };

  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Emission factors'), h('p', { class: 'sub' }, 'The versioned library behind every calculation. Nothing is hidden and no factor is invented by AI.'))),
    h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, `${reg.factors.filter((x) => x.status !== 'validated').length} of ${reg.factors.length} factors are provisional. The grid factor is the proposal's CEA v20 value and CEA now lists a later version. Waste parameters (IPCC 2006 Vol. 5 defaults) are provisional as a set.`)),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 16), h('input', { type: 'search', placeholder: 'Search factors', 'aria-label': 'Search factors', oninput: debounce((e) => { f.q = e.target.value; apply(); }, 150) })),
      select([['', 'Any status'], ['provisional', 'Provisional'], ['validated', 'Validated']], '', { 'aria-label': 'Status', onchange: (e) => { f.status = e.target.value; apply(); } }), select([['', 'All types'], ['grid_electricity', 'Grid electricity'], ['fuel', 'Fuel']], '', { 'aria-label': 'Type', onchange: (e) => { f.kind = e.target.value; apply(); } })), table,
      h('p', { class: 'muted' }, `Register ${reg.version} · hash ${reg.hash.slice(0, 16)}… (recorded in every calculation so results can be reproduced)`)),
    h('div', { class: 'card' }, h('h3', {}, 'How a factor becomes validated'), h('ol', { class: 'muted', style: 'padding-left:18px' }, h('li', {}, 'A named reviewer opens the original table (for example the CEA user guide for the reporting year).'), h('li', {}, 'They copy the values into data/factors.local.json, set status to validated, and add their name and date.'), h('li', {}, 'Old versions stay in the register so past reports still reproduce.'), h('li', {}, 'Only then can a report be marked internally reviewed.'))));
}
