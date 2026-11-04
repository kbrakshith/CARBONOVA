// CARBONOVA design-system components. Every page builds from these so spacing, states and behaviour stay consistent.
import { h, put, icon, fmt } from './dom.js';

export const pageHeader = ({ title, subtitle, actions = [] }) => h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, title), subtitle ? h('p', { class: 'sub' }, subtitle) : null), h('div', { class: 'head-actions' }, ...actions));

export const emptyState = ({ icon: ic = 'leaf', title, body, action }) => h('div', { class: 'empty' }, h('span', { class: 'empty-ico' }, icon(ic, 22)), h('h3', {}, title), body ? h('p', { class: 'muted' }, body) : null, action ?? null);

export const btn = (text, { kind = 'secondary', ic, onclick, type = 'button', size, disabled, title } = {}) =>
  h('button', { class: `btn ${kind}${size ? ' ' + size : ''}`, type, onclick, disabled: disabled ? true : null, title }, ic ? icon(ic, 16) : null, text);

export const STATUS = {
  confirmed: ['ok', 'Reviewed'], needs_review: ['warn', 'Pending review'], measured: ['ok', 'Measured'], estimated: ['info', 'Estimated'], missing: ['err', 'Missing'],
  draft: ['neutral', 'Draft'], self_declared: ['info', 'Self-declared'], internally_reviewed: ['ok', 'Internally reviewed'], externally_assured: ['ok', 'Externally assured'],
  provisional: ['warn', 'Provisional'], validated: ['ok', 'Validated'], retired: ['neutral', 'Retired'],
  uploaded: ['info', 'Uploaded'], rejected: ['err', 'Rejected'],
  saved: ['neutral', 'Saved'], planned: ['info', 'Planned'], in_progress: ['warn', 'In progress'], completed: ['ok', 'Completed'], dismissed: ['neutral', 'Dismissed'],
  calculated: ['ok', 'Assessed'], not_assessed: ['neutral', 'Not assessed'], excluded: ['neutral', 'Excluded'],
};
export const status = (key, text) => { const [k, t] = STATUS[key] ?? ['neutral', key]; return h('span', { class: `pill ${k}` }, text ?? t); };

/** Native <dialog> modal: focus trap, Escape and backdrop close come from the platform. */
export function modal({ title, body, footer, size = 'md', onClose }) {
  const dlg = h('dialog', { class: `modal ${size}`, 'aria-labelledby': 'modal-title' });
  const close = (v) => { if (dlg.open) dlg.close(); dlg.remove(); onClose?.(v); };
  dlg.append(h('div', { class: 'modal-head' }, h('h3', { id: 'modal-title' }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-body' }, body), footer ? h('div', { class: 'modal-foot' }, footer) : null);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, reasonLabel }) {
  return new Promise((resolve) => {
    const reason = reasonLabel ? h('textarea', { rows: 2, 'aria-label': reasonLabel, placeholder: reasonLabel }) : null;
    const err = h('p', { class: 'field-err' });
    const m = modal({ title, size: 'sm', body: [h('p', {}, message), reason, err],
      footer: [btn('Cancel', { onclick: () => { resolve(false); m.close(); } }),
        btn(confirmText, { kind: danger ? 'danger' : 'primary', onclick: () => { if (reason && reason.value.trim().length < 3) { err.textContent = 'Please give a short reason. It is kept in the audit trail.'; return; } resolve(reason ? reason.value.trim() : true); m.close(); } })],
      onClose: () => resolve(false) });
  });
}

/** Dropdown menu attached to a trigger button. items: [{label, ic, onclick, danger}] or {divider:true}. */
export function menu(trigger, items, { align = 'right' } = {}) {
  let pop = null;
  const closeMenu = () => { pop?.remove(); pop = null; trigger.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !trigger.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { closeMenu(); trigger.focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const els = [...pop.querySelectorAll('button')]; const i = els.indexOf(document.activeElement); els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus(); } };
  trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => {
    if (pop) return closeMenu();
    pop = h('div', { class: `menu ${align}`, role: 'menu' }, (typeof items === 'function' ? items() : items).map((it) => it.divider ? h('hr') : it.header ? h('div', { class: 'menu-h' }, it.header) : h('button', { class: `menu-i${it.danger ? ' danger' : ''}`, role: 'menuitem', type: 'button', onclick: () => { closeMenu(); it.onclick?.(); } }, it.ic ? icon(it.ic, 16) : null, it.label)));
    trigger.parentElement.style.position = 'relative';
    trigger.after(pop);
    trigger.setAttribute('aria-expanded', 'true');
    pop.querySelector('button')?.focus();
    document.addEventListener('click', outside, true); document.addEventListener('keydown', onKey, true);
  });
  return { close: closeMenu };
}

export function tabs(items, active, onChange) {
  const wrap = h('div', { class: 'tabs', role: 'tablist' });
  const draw = (cur) => put(wrap, items.map(([k, t]) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(k === cur), class: k === cur ? 'on' : '', onclick: () => { draw(k); onChange(k); } }, t)));
  draw(active);
  return wrap;
}

/** Labelled form field with hint and inline error slot. */
export function formField(labelText, input, { hint, error, required } = {}) {
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  if (required) input.setAttribute('aria-required', 'true');
  const err = h('span', { class: 'field-err', id: `${id}-e`, role: 'alert' }, error ?? '');
  input.setAttribute('aria-describedby', `${id}-e`);
  const w = h('div', { class: 'field' }, h('label', { for: id }, labelText, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null), input, hint ? h('span', { class: 'hint' }, hint) : null, err);
  w.setError = (m) => { err.textContent = m ?? ''; input.classList.toggle('invalid', !!m); input.setAttribute('aria-invalid', m ? 'true' : 'false'); };
  return w;
}

export const select = (opts, value, attrs = {}) => h('select', attrs, opts.map(([v, t]) => h('option', { value: v, selected: v === value ? true : null }, t)));

/** Sortable, paginated table. Call .update(rows) to refresh. */
export function dataTable({ columns, rows = [], pageSize = 10, sort, empty, rowClass, caption }) {
  const st = { rows, page: 1, key: sort?.key, dir: sort?.dir ?? 'desc' };
  const head = h('thead'), bodyEl = h('tbody'), pager = h('div', { class: 'pager' });
  const el = h('div', { class: 'tbl' }, h('div', { class: 'tablewrap' }, h('table', {}, caption ? h('caption', { class: 'sr' }, caption) : null, head, bodyEl)), pager);
  const cmp = (a, b) => { const c = columns.find((x) => x.key === st.key); const va = c?.sortValue ? c.sortValue(a) : a[st.key], vb = c?.sortValue ? c.sortValue(b) : b[st.key]; const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? '')); return st.dir === 'asc' ? r : -r; };
  const draw = () => {
    put(head, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.class ?? '', 'aria-sort': c.sortable && st.key === c.key ? (st.dir === 'asc' ? 'ascending' : 'descending') : null },
      c.sortable ? h('button', { class: 'th-btn', type: 'button', onclick: () => { st.dir = st.key === c.key && st.dir === 'asc' ? 'desc' : 'asc'; st.key = c.key; draw(); } }, c.label, st.key === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '') : c.label))));
    const sorted = st.key ? [...st.rows].sort(cmp) : st.rows;
    const pages = Math.max(Math.ceil(sorted.length / pageSize), 1);
    st.page = Math.min(st.page, pages);
    const slice = sorted.slice((st.page - 1) * pageSize, st.page * pageSize);
    if (!slice.length) put(bodyEl, h('tr', {}, h('td', { colspan: columns.length }, empty ?? h('p', { class: 'muted' }, 'Nothing to show.'))));
    else put(bodyEl, slice.map((r) => h('tr', { class: rowClass?.(r) ?? '' }, columns.map((c) => h('td', { class: c.class ?? '', 'data-label': c.label }, c.render ? c.render(r) : r[c.key] ?? '')))));
    put(pager, sorted.length > pageSize ? [h('span', { class: 'muted' }, `${(st.page - 1) * pageSize + 1}-${Math.min(st.page * pageSize, sorted.length)} of ${sorted.length}`),
      h('div', { class: 'row-tight' }, btn('', { ic: 'left', size: 'sm', disabled: st.page === 1, onclick: () => { st.page--; draw(); }, title: 'Previous page' }), h('span', { class: 'muted' }, `Page ${st.page} of ${pages}`), btn('', { ic: 'right', size: 'sm', disabled: st.page === pages, onclick: () => { st.page++; draw(); }, title: 'Next page' }))] : h('span', { class: 'muted' }, `${sorted.length} ${sorted.length === 1 ? 'row' : 'rows'}`));
  };
  draw();
  el.update = (r) => { st.rows = r; st.page = 1; draw(); };
  return el;
}

export const skeleton = (n = 3) => h('div', { class: 'skel-wrap', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('div', { class: 'skel' })));
export const stat = (label, value, { sub, tone } = {}) => h('div', { class: `metric${tone ? ' ' + tone : ''}` }, h('span', { class: 'm-l' }, label), h('b', { class: 'm-v' }, value), sub ? h('span', { class: 'm-s' }, sub) : null);
export const t = (x, d) => fmt(x, d ?? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2));
export const demoBanner = () => h('div', { class: 'banner info' }, icon('info', 16), h('span', {}, 'Illustrative demo data for a fictional unit. Figures are not real and use provisional factors.'));
