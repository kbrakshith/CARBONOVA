import { h, put, icon, toast, fmt, debounce } from '../dom.js';
import { btn, dataTable, status, emptyState, menu, confirmDialog, modal, select } from '../ui.js';
import { S, api } from '../state.js';
import { orgUrl, refreshAll } from '../session.js';
import { openRecordForm, KINDS } from '../recordform.js';
import { openCalcForRecord } from '../lines.js';

const KIND_LABEL = Object.fromEntries(KINDS);
const SCOPE_PILL = { 1: 'Scope 1', 2: 'Scope 2', 3: 'Scope 3' };

export async function render(root, go) {
  const { records } = await api('GET', orgUrl('/records'));
  const f = { q: '', scope: '', kind: '', from: '', to: '', review: '' };
  const live = () => records.filter((r) => !r.voided);
  const inFy = (r) => { const y = Number(S.fy.slice(0, 4)); return r.period.start >= `${y}-04-01` && r.period.start <= `${y + 1}-03-31`; };

  const refresh = async () => { await refreshAll(); go('records', true); };
  const add = () => openRecordForm({ onSaved: refresh });

  const view = async (r) => {
    const doc = r.document_id ? S.docs.find((d) => d.id === r.document_id) : null;
    const m = modal({ title: r.name, size: 'md', body: [
      h('div', { class: 'row-tight', style: 'flex-wrap:wrap;margin-bottom:12px' }, status(r.review_status), status(r.data_quality), h('span', { class: 'pill neutral' }, SCOPE_PILL[r.scope] + (r.scope3_category ? ` · cat ${r.scope3_category}` : '')), r.duplicate_of.length ? h('span', { class: 'pill warn' }, 'Possible duplicate') : null),
      h('dl', { class: 'kv' }, h('dt', {}, 'Record ID'), h('dd', {}, r.id), h('dt', {}, 'Category'), h('dd', {}, r.category), h('dt', {}, 'Quantity'), h('dd', {}, `${fmt(r.quantity, r.unit === 'kWh' ? 0 : 2)} ${r.unit}`),
        h('dt', {}, 'Period'), h('dd', {}, `${r.period.start} to ${r.period.end}`), h('dt', {}, 'Facility'), h('dd', {}, S.org.inventory.organisation.facilities.find((x) => x.id === r.facility_id)?.name ?? '-'),
        h('dt', {}, 'Data source'), h('dd', {}, r.source), r.raw.estimation_basis ? [h('dt', {}, 'Estimate basis'), h('dd', {}, r.raw.estimation_basis)] : null,
        r.raw.asset ? [h('dt', {}, 'Asset'), h('dd', {}, r.raw.asset)] : null, r.duplicate_of.length ? [h('dt', {}, 'Looks like'), h('dd', {}, r.duplicate_of.join(', '))] : null)],
      footer: [doc ? btn('Open source document', { ic: 'file', onclick: () => { m.close(); go(`documents/${doc.id}`); } }) : null, btn('See calculation', { ic: 'chart', onclick: () => { m.close(); openCalcForRecord(r).catch((e) => toast(e.message, 'err')); } }), btn('Close', { onclick: () => m.close() })] });
  };
  const del = async (r) => {
    const reason = await confirmDialog({ title: `Delete ${r.name}?`, message: 'The record is removed from your totals. It stays in the audit trail with your reason, so a reviewer can still see what was deleted.', confirmText: 'Delete record', danger: true, reasonLabel: 'Reason for deleting' });
    if (!reason) return;
    await api('POST', orgUrl(`/records/${r.id}/void`), { reason });
    toast('Record deleted. It remains in the audit trail.');
    await refresh();
  };
  const approve = async (r) => { await api('POST', orgUrl(`/records/${r.id}/review`), { status: 'confirmed' }); toast('Approved. It is now included in the totals.'); await refresh(); };

  const columns = [
    { key: 'name', label: 'Activity', sortable: true, render: (r) => h('div', {}, h('b', {}, r.name), r.duplicate_of.length ? h('div', { class: 'muted', title: `Same details as ${r.duplicate_of.join(', ')}` }, icon('copy', 12), ` Possible duplicate of ${r.duplicate_of[0]}`) : null) },
    { key: 'category', label: 'Category', sortable: true },
    { key: 'scope', label: 'Scope', sortable: true, render: (r) => h('span', { class: 'pill neutral' }, SCOPE_PILL[r.scope]) },
    { key: 'quantity', label: 'Quantity', class: 'num', sortable: true, render: (r) => fmt(r.quantity, Number.isInteger(r.quantity) ? 0 : 2) },
    { key: 'unit', label: 'Unit' },
    { key: 'period', label: 'Reporting period', sortable: true, sortValue: (r) => r.period.start, render: (r) => (r.period.start === r.period.end ? r.period.start : `${r.period.start} to ${r.period.end}`) },
    { key: 'source', label: 'Data source', render: (r) => h('span', { class: 'muted' }, r.source) },
    { key: 'review_status', label: 'Review status', sortable: true, render: (r) => status(r.review_status) },
    { key: 'act', label: 'Actions', render: (r) => { const b = h('button', { class: 'icon-btn', 'aria-label': `Actions for ${r.name}` }, icon('down', 16)); const w = h('div', { class: 'cell-act' }, btn('', { ic: 'eye', size: 'sm', title: 'View details', onclick: () => view(r) }), b); menu(b, () => [
      { label: 'View details', ic: 'eye', onclick: () => view(r) }, { label: 'See calculation', ic: 'chart', onclick: () => openCalcForRecord(r).catch((e) => toast(e.message, 'err')) },
      ...(r.review_status === 'needs_review' ? [{ label: 'Approve for totals', ic: 'check', onclick: () => approve(r) }] : []), { label: 'Edit', ic: 'edit', onclick: () => openRecordForm({ record: r, onSaved: refresh }) }, { divider: true }, { label: 'Delete', ic: 'trash', danger: true, onclick: () => del(r) }]); return w; } },
  ];
  const table = dataTable({ columns, rows: [], sort: { key: 'period', dir: 'desc' }, pageSize: 10, rowClass: (r) => (r.duplicate_of.length ? 'dup' : ''), caption: 'Activity records',
    empty: emptyState({ icon: 'list', title: 'No records match', body: 'Try clearing the filters or add a record.', action: btn('Add activity', { kind: 'primary', ic: 'plus', onclick: add }) }) });
  table.querySelector('table').classList.add('stack');

  const counter = h('span', { class: 'muted' });
  const apply = () => {
    const q = f.q.trim().toLowerCase();
    const rows = live().filter((r) => (S.fy ? inFy(r) || f.from || f.to : true) && (!q || `${r.name} ${r.category} ${r.source} ${r.id}`.toLowerCase().includes(q)) && (!f.scope || String(r.scope) === f.scope) && (!f.kind || r.kind === f.kind)
      && (!f.review || r.review_status === f.review) && (!f.from || r.period.start >= f.from) && (!f.to || r.period.end <= f.to));
    table.update(rows);
    counter.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'} in FY ${S.fy}${f.from || f.to ? ' (date filter applied across years)' : ''}`;
  };
  const sInput = h('input', { type: 'search', placeholder: 'Search by name, category, source or ID', 'aria-label': 'Search records', oninput: debounce((e) => { f.q = e.target.value; apply(); }, 150) });
  const sel = (key, opts, label) => select(opts, '', { 'aria-label': label, onchange: (e) => { f[key] = e.target.value; apply(); } });
  const dateIn = (key, label) => h('input', { type: 'date', 'aria-label': label, title: label, onchange: (e) => { f[key] = e.target.value; apply(); } });

  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Activity records'), h('p', { class: 'sub' }, 'Everything that feeds your footprint: bills, fuel, transport and waste.')), h('div', { class: 'head-actions' }, btn('Add activity', { kind: 'primary', ic: 'plus', onclick: add }))),
    S.app.demo ? h('div', { class: 'banner info' }, icon('info', 16), h('span', {}, 'Demo data (illustrative).')) : null,
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 16), sInput),
      sel('scope', [['', 'All scopes'], ['1', 'Scope 1'], ['2', 'Scope 2'], ['3', 'Scope 3']], 'Filter by scope'), sel('kind', [['', 'All types'], ...KINDS], 'Filter by activity type'), sel('review', [['', 'Any status'], ['confirmed', 'Reviewed'], ['needs_review', 'Pending review']], 'Filter by status'),
      dateIn('from', 'From date'), dateIn('to', 'To date')), counter, table));
  apply();
  void KIND_LABEL;
}
