import { h, put, icon, toast } from '../dom.js';
import { btn, formField, select, modal, confirmDialog, dataTable, emptyState } from '../ui.js';
import { S, api } from '../state.js';
import { orgUrl, refreshAll } from '../session.js';

const STATES = ['Andhra Pradesh', 'Delhi', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal', 'Other'];
const TYPES = ['Micro enterprise - manufacturing', 'Small enterprise - manufacturing', 'Medium enterprise - manufacturing', 'Micro enterprise - services', 'Small enterprise - services', 'Medium enterprise - services', 'Trader / distributor', 'Other'];

export async function render(root, go) {
  await refreshAll();
  const o = S.org.inventory.organisation;
  const fys = [...new Set([...S.summary.fys, o.reporting_fy])].sort().reverse();
  const section = (title, desc, fields, onSave, extra) => {
    const err = h('div');
    const saveBtn = btn('Save changes', { kind: 'primary', onclick: async () => {
      saveBtn.classList.add('loading'); put(err);
      try { await onSave(); toast(`${title} saved.`); await refreshAll(); } catch (e) { put(err, h('div', { class: 'banner err', role: 'alert' }, icon('alert', 16), h('span', {}, e.data?.errors ? e.data.errors.map((x) => x.message).join(' ') : e.message))); } finally { saveBtn.classList.remove('loading'); }
    } });
    return h('section', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted' }, desc), h('div', { class: 'grid' }, ...fields), extra ?? null, err, h('div', { class: 'row' }, saveBtn));
  };
  const inp = (v, a = {}) => h('input', { value: v ?? '', ...a });
  const name = inp(o.legal_name, { required: true }), btype = select(TYPES.map((x) => [x, x]), o.business_type ?? TYPES[1]);
  const industry = select(S.catalog.industries.map((i) => [i.id, i.label]), o.industry);
  const cName = inp(o.contact?.name), cMail = inp(o.contact?.email, { type: 'email' }), cPhone = inp(o.contact?.phone, { type: 'tel' });
  const state = select(STATES.map((x) => [x, x]), STATES.includes(o.state) ? o.state : 'Other'), loc = inp(o.location);
  const fy = select(fys.map((x) => [x, `FY ${x}`]), o.reporting_fy), cons = select([['operational_control', 'Operational control'], ['financial_control', 'Financial control'], ['equity_share', 'Equity share']], o.consolidation_approach);
  const rev = inp(o.revenue_inr ?? '', { type: 'number', min: '0' });
  const gwp = select(Object.entries(S.catalog.gwp_sets), S.app.gwp_set ?? 'AR6');
  const excl = h('textarea', { rows: 3, placeholder: 'One per line, e.g. Employee commuting not assessed' }, (o.exclusions ?? []).join('\n'));

  const facBox = h('div');
  const drawFac = () => {
    const tb = dataTable({ columns: [
      { key: 'name', label: 'Facility', render: (f) => h('b', {}, f.name) }, { key: 'type', label: 'Type' }, { key: 'state', label: 'State' },
      { key: 'n', label: 'Records', class: 'num', render: (f) => String(S.org.inventory.activities.filter((a) => a.facility_id === f.id && !a.voided).length) },
      { key: 'a', label: '', render: (f) => h('div', { class: 'cell-act' }, btn('Edit', { size: 'sm', ic: 'edit', onclick: () => facModal(f) }), btn('Remove', { size: 'sm', ic: 'trash', onclick: () => removeFac(f) })) }], rows: S.org.inventory.organisation.facilities, pageSize: 10, caption: 'Facilities', empty: emptyState({ title: 'No facilities' }) });
    tb.querySelector('table').classList.add('stack');
    put(facBox, tb);
  };
  const saveFacilities = async (list) => { await api('PUT', orgUrl('/profile'), { facilities: list }); await refreshAll(); drawFac(); };
  function facModal(f) {
    const nm = inp(f?.name), ty = select([['Plant', 'Plant'], ['Warehouse', 'Warehouse'], ['Office', 'Office'], ['Other', 'Other']], f?.type || 'Plant'), st = inp(f?.state ?? o.state);
    const nmF = formField('Facility name', nm, { required: true });
    const m = modal({ title: f ? 'Edit facility' : 'Add facility', size: 'sm', body: [nmF, formField('Type', ty), formField('State', st)], footer: [btn('Cancel', { onclick: () => m.close() }), btn('Save', { kind: 'primary', onclick: async () => {
      if (!nm.value.trim()) return nmF.setError('Enter a name.');
      const list = S.org.inventory.organisation.facilities.map((x) => ({ ...x }));
      if (f) Object.assign(list.find((x) => x.id === f.id), { name: nm.value.trim(), type: ty.value, state: st.value }); else { let n = list.length + 1; while (list.some((x) => x.id === `F${n}`)) n++; list.push({ id: `F${n}`, name: nm.value.trim(), type: ty.value, state: st.value }); }
      try { await saveFacilities(list); m.close(); toast('Facility saved.'); } catch (e) { nmF.setError(e.message); }
    } })] });
  }
  async function removeFac(f) {
    if (S.org.inventory.organisation.facilities.length === 1) return toast('You need at least one facility.', 'err');
    if (!(await confirmDialog({ title: `Remove ${f.name}?`, message: 'Only possible when it has no records.', confirmText: 'Remove', danger: true }))) return;
    try { await saveFacilities(S.org.inventory.organisation.facilities.filter((x) => x.id !== f.id)); toast('Facility removed.'); } catch (e) { toast(e.message, 'err'); }
  }
  drawFac();

  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Business profile'), h('p', { class: 'sub' }, 'These details define your reporting boundary and appear on your reports.'))),
    section('Business information', 'Who the report is about.', [formField('Business name', name, { required: true }), formField('Business type', btype), formField('Industry', industry, { hint: 'Decides which wastes are expected at each production stage. Changing it clears stage-wise waste inputs.' }), formField('Contact person', cName), formField('Contact email', cMail), formField('Contact phone', cPhone)],
      () => api('PUT', orgUrl('/profile'), { legal_name: name.value.trim(), business_type: btype.value, industry: industry.value, contact: { name: cName.value, email: cMail.value, phone: cPhone.value } })),
    section('Location', 'Where you operate.', [formField('State', state), formField('City / area', loc)], () => api('PUT', orgUrl('/profile'), { state: state.value, location: loc.value })),
    section('Reporting', 'Financial year follows the Indian April to March calendar.', [formField('Current reporting year', fy), formField('Consolidation approach', cons, { hint: 'How we decide which assets count as yours.' }), formField('Annual turnover (INR)', rev, { hint: 'Used for intensity per ₹ million.' }), formField('GWP basis', gwp, { hint: 'Global warming potentials used to convert gases to CO₂e.' })],
      async () => { await api('PUT', orgUrl('/profile'), { reporting_fy: fy.value, consolidation_approach: cons.value, revenue_inr: rev.value ? Number(rev.value) : null }); await api('PUT', orgUrl('/settings'), { gwp_set: gwp.value }); S.fy = fy.value; }),
    section('Organisational boundary', 'What is inside and outside the report.', [formField('Declared exclusions', excl, { hint: 'Anything you leave out on purpose. These appear in every report.' })], () => api('PUT', orgUrl('/profile'), { exclusions: excl.value.split('\n').map((x) => x.trim()).filter(Boolean) })),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Facilities'), btn('Add facility', { ic: 'plus', onclick: () => facModal() })), h('p', { class: 'muted' }, `${o.facilities.length} facilit${o.facilities.length === 1 ? 'y' : 'ies'} in the boundary.`), facBox));
  void go;
}
