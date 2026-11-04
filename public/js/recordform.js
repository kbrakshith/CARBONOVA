// Add / edit activity. The form changes with the activity type; inline validation first, server validation second.
import { h, put, toast, icon } from './dom.js';
import { modal, btn, formField, select } from './ui.js';
import { S, api } from './state.js';
import { orgUrl, aiReady } from './session.js';

export const KINDS = [
  ['electricity', 'Electricity'], ['diesel', 'Diesel'], ['petrol', 'Petrol'], ['lpg', 'LPG'], ['transport', 'Transport (hired vehicles)'], ['waste', 'Waste'], ['refrigerant', 'Refrigerant top-up'], ['fuel_other', 'Other fuel'],
];
const FUEL_UNITS = { diesel: [['L', 'litres'], ['kL', 'kilolitres']], petrol: [['L', 'litres'], ['kL', 'kilolitres']], lpg: [['kg', 'kg (cylinder weight)'], ['t', 'tonnes']], transport: [['L', 'litres'], ['kL', 'kilolitres']], fuel_other: [['kg', 'kg'], ['t', 'tonnes'], ['L', 'litres']] };
const OTHER_FUELS = [['furnace_oil', 'Furnace oil'], ['coal', 'Coal'], ['natural_gas', 'Natural gas'], ['petcoke', 'Petroleum coke'], ['biomass_wood', 'Wood / biomass']];

export function openRecordForm({ record, kind: presetKind, onSaved, presetDoc } = {}) {
  const editing = !!record;
  const org = S.org.inventory.organisation;
  const raw = record?.raw ?? {};
  let kind = record?.kind ?? presetKind ?? 'electricity';
  const body = h('div');
  const errBox = h('div');
  let fields = {};

  const num = (label, key, { required, hint, value, step = 'any' } = {}) => { const i = h('input', { type: 'number', min: '0', step, inputmode: 'decimal', value: value ?? '' }); fields[key] = formField(label, i, { hint, required }); fields[key].input = i; return fields[key]; };
  const txt = (label, key, { required, hint, value, placeholder } = {}) => { const i = h('input', { value: value ?? '', placeholder }); fields[key] = formField(label, i, { hint, required }); fields[key].input = i; return fields[key]; };
  const sel = (label, key, opts, value, { hint, onchange } = {}) => { const i = select(opts, value, onchange ? { onchange } : {}); fields[key] = formField(label, i, { hint }); fields[key].input = i; return fields[key]; };
  const date = (label, key, { required, value, hint } = {}) => { const i = h('input', { type: 'date', value: value ?? '' }); fields[key] = formField(label, i, { required, hint }); fields[key].input = i; return fields[key]; };

  const draw = () => {
    fields = {};
    errBox.replaceChildren();
    const parts = [];
    const dq = raw.data_quality ?? (kind === 'transport' ? 'estimated' : 'measured');
    const nameHint = 'Optional. A clear name helps you find it later.';
    parts.push(txt('Activity name', 'label', { value: record?.raw.label ?? record?.name ?? '', hint: nameHint, placeholder: kind === 'electricity' ? 'e.g. Plant electricity - November' : 'e.g. DG set diesel' }));
    if (aiReady() && !editing) parts.push(h('div', { class: 'field', style: 'justify-content:end' }, btn('Suggest type from name (AI)', { ic: 'bolt', size: 'sm', onclick: async (e) => {
      const d = fields.label.input.value.trim(); if (!d) return fields.label.setError('Type a short description first.');
      const b = e.currentTarget; b.classList.add('loading');
      try { const r = await api('POST', orgUrl('/ai/classify'), { description: d }); const keep = d; kind = r.kind; kindSelEl.value = r.kind; draw(); fields.label.input.value = keep; toast(`AI suggests: ${KINDS.find(([k]) => k === r.kind)?.[1]}. ${r.reason} Check it before saving.`); }
      catch (err) { b.classList.remove('loading'); toast(err.message, 'err'); }
    } })));
    if (kind === 'waste') {
      const cls = S.catalog.waste_classes;
      parts.push(sel('Waste type', 'waste_class', cls.map((c) => [c.id, `${c.label}${c.hazardous ? ' (hazardous)' : ''}`]), raw.waste_class ?? 'paper_cardboard', { hint: 'Hazardous waste can only go to authorised facilities.', onchange: () => drawRoutes() }));
      parts.push(num('Weight (tonnes)', 'tonnes', { required: true, value: raw.tonnes, hint: 'From your weighbridge, manifest or sale receipt.' }));
      parts.push(date('Date or period end', 'start', { required: true, value: raw.period?.start }));
      const routeHost = h('div');
      const drawRoutes = () => {
        const haz = S.catalog.waste_classes.find((c) => c.id === fields.waste_class.input.value)?.hazardous;
        const keep = fields.route?.input?.value;
        const opts = S.catalog.routes.filter((r) => !r.prohibited && (!haz || r.hazardous_ok)).map((r) => [r.id, r.label]);
        fields.route = formField('Where it goes', select(opts, opts.some(([v]) => v === (keep ?? raw.route)) ? (keep ?? raw.route) : opts[0][0]), { hint: haz ? 'Only routes allowed for hazardous waste are shown.' : 'Recycling and recovery routes reduce your disposal footprint.' });
        fields.route.input = fields.route.querySelector('select');
        put(routeHost, fields.route);
      };
      drawRoutes();
      parts.push(routeHost);
      parts.push(sel('Where is it treated?', 'location', [['offsite', 'Off-site (third party)'], ['onsite', 'On-site (inside our boundary)']], raw.location ?? 'offsite', { hint: 'On-site treatment is counted as Scope 1, off-site as Scope 3.' }));
      parts.push(txt('Facility name / authorisation no.', 'facility', { value: raw.facility ?? '', hint: 'Needed for hazardous waste (SPCB authorisation).' }));
    } else {
      parts.push(sel('Facility', 'facility_id', org.facilities.map((f) => [f.id, f.name]), raw.facility_id ?? org.facilities[0].id));
      parts.push(date(kind === 'electricity' ? 'Billing period start' : 'Date or period start', 'start', { required: true, value: raw.period?.start }));
      parts.push(date(kind === 'electricity' ? 'Billing period end' : 'Period end', 'end', { value: raw.period?.end, hint: kind === 'electricity' ? undefined : 'Leave empty for a single purchase date.' }));
      if (kind === 'electricity') {
        parts.push(sel('Electricity source', 'source', [['grid', 'Grid (DISCOM bill)'], ['grid_solar', 'Grid plus on-site solar']], raw.source ?? 'grid', { hint: 'Only grid units carry the grid emission factor.', onchange: () => { solarBox.hidden = fields.source.input.value !== 'grid_solar'; } }));
        parts.push(num('Grid consumption (kWh)', 'quantity', { required: true, value: raw.grid_import_kwh, hint: 'Units consumed in this billing period, exactly as on the bill.' }));
        parts.push(txt('Meter / consumer number', 'meter_id', { value: raw.meter_id ?? '', hint: 'Used to stop overlapping bills on the same meter.' }));
        const solarBox = h('div', { class: 'grid', hidden: (raw.source ?? 'grid') !== 'grid_solar' }, num('Solar generated (kWh)', 'solar_generated_kwh', { value: raw.solar_generated_kwh }), num('Solar used on site (kWh)', 'solar_self_consumed_kwh', { value: raw.solar_self_consumed_kwh }), num('Solar exported (kWh)', 'solar_exported_kwh', { value: raw.solar_exported_kwh }));
        parts.push(solarBox);
        parts.push(num('Renewable energy under contract (kWh)', 'contractual_re_kwh', { value: raw.contractual_re_kwh, hint: 'Only with a documented contract or certificate. Optional.' }));
      } else if (kind === 'refrigerant') {
        parts.push(sel('Refrigerant', 'refrigerant', [['R-410A', 'R-410A'], ['R-32', 'R-32'], ['R-134a', 'R-134a']], raw.refrigerant ?? 'R-410A'));
        parts.push(num('Quantity refilled (kg)', 'quantity', { required: true, value: raw.quantity, hint: 'Gas topped up after a leak is treated as the amount leaked.' }));
      } else {
        if (kind === 'fuel_other') parts.push(sel('Fuel', 'fuel', OTHER_FUELS, raw.fuel ?? 'furnace_oil'));
        if (kind === 'transport') {
          parts.push(sel('Fuel', 'fuel', [['diesel', 'Diesel'], ['petrol', 'Petrol']], raw.fuel ?? 'diesel'));
          parts.push(sel('Value-chain category', 'scope3_category', [['4', 'Upstream transport and distribution'], ['6', 'Business travel'], ['7', 'Employee commuting'], ['9', 'Downstream transport']], String(raw.scope3_category ?? 4), { hint: 'Fuel bought for vehicles you do not own or control is Scope 3.' }));
        }
        parts.push(num('Quantity', 'quantity', { required: true, value: raw.quantity }));
        parts.push(sel('Unit', 'unit', FUEL_UNITS[kind], raw.unit ?? FUEL_UNITS[kind][0][0]));
        if (kind !== 'transport') parts.push(sel('Used in', 'use', [['stationary', 'Generator, boiler or furnace'], ['mobile', 'Vehicle']], raw.use ?? (kind === 'petrol' ? 'mobile' : 'stationary')));
        parts.push(txt('Asset or usage details', 'asset', { value: raw.asset ?? '', placeholder: 'e.g. 125 kVA DG set, delivery van' }));
      }
    }
    parts.push(sel('Data quality', 'data_quality', [['measured', 'Measured (bill, meter, receipt)'], ['estimated', 'Estimated']], dq, { onchange: () => { fields.estimation_basis.hidden = fields.data_quality.input.value !== 'estimated'; } }));
    parts.push(txt('How was it estimated?', 'estimation_basis', { value: raw.estimation_basis ?? '', hint: 'Required for estimates.' }));
    fields.estimation_basis.hidden = dq !== 'estimated';
    if (kind !== 'waste') {
      const docs = S.docs.filter((d) => d.status !== 'rejected');
      const cur = raw.evidence?.id;
      parts.push(sel('Supporting document', 'doc', [['', 'None'], ...docs.map((d) => [d.id, `${d.name}${d.status === 'needs_review' ? ' (pending review)' : ''}`])], docs.find((d) => d.name === cur)?.id ?? '', { hint: 'Attach a bill or receipt already uploaded. Upload new ones in Documents.' }));
    }
    const rev = h('input', { type: 'checkbox', checked: (raw.review_status ?? 'confirmed') === 'confirmed' ? true : null, id: 'rv' });
    fields.review = { input: rev };
    parts.push(h('label', { class: 'row-tight', for: 'rv', style: 'font-weight:500' }, rev, 'I have checked these figures. Unchecked records stay out of the totals.'));
    put(body, h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(240px,1fr))' }, ...parts));
  };

  const kindSelEl = select(KINDS, kind, { onchange: (e) => { kind = e.target.value; draw(); } });
  const kindSel = editing ? h('p', { class: 'muted' }, `Type: ${KINDS.find(([k]) => k === kind)?.[1] ?? kind} (cannot be changed once saved)`) : formField('What are you recording?', kindSelEl);
  draw();

  const val = (k) => fields[k]?.input?.value ?? '';
  const validate = () => {
    let ok = true;
    const bad = (k, m) => { fields[k]?.setError(m); ok = false; };
    for (const f of Object.values(fields)) f.setError?.('');
    const q = kind === 'waste' ? 'tonnes' : 'quantity';
    if (val(q) === '' || !(Number(val(q)) >= 0)) bad(q, 'Enter a number, 0 or more.');
    else if (Number(val(q)) === 0 && kind !== 'waste') bad(q, 'A quantity of zero adds nothing. Leave the record out instead.');
    if (!val('start')) bad('start', 'Choose a date.');
    if (val('end') && val('start') && val('end') < val('start')) bad('end', 'The end date is before the start date.');
    if (kind === 'electricity' && !val('meter_id').trim()) bad('meter_id', 'Enter the meter or consumer number from the bill.');
    if (kind === 'waste' && !val('label').trim()) bad('label', 'Give the waste a name.');
    if (val('data_quality') === 'estimated' && !val('estimation_basis').trim()) bad('estimation_basis', 'Say how the figure was estimated.');
    return ok;
  };

  const save = btn(editing ? 'Save changes' : 'Save record', { kind: 'primary', onclick: async () => {
    if (!validate()) return;
    save.classList.add('loading'); errBox.replaceChildren();
    const g = (k) => (val(k) === '' ? undefined : val(k));
    const payload = { kind, label: g('label'), facility_id: g('facility_id'), start: g('start'), end: g('end'), quantity: g(kind === 'waste' ? 'tonnes' : 'quantity'), data_quality: g('data_quality'), estimation_basis: g('estimation_basis'), review_status: fields.review.input.checked ? 'confirmed' : 'needs_review' };
    if (kind === 'electricity') Object.assign(payload, { meter_id: g('meter_id'), source: g('source'), solar_generated_kwh: g('solar_generated_kwh'), solar_self_consumed_kwh: g('solar_self_consumed_kwh'), solar_exported_kwh: g('solar_exported_kwh'), contractual_re_kwh: g('contractual_re_kwh') });
    else if (kind === 'refrigerant') payload.refrigerant = g('refrigerant');
    else if (kind === 'waste') Object.assign(payload, { waste_class: g('waste_class'), route: g('route'), location: g('location'), facility: g('facility') });
    else Object.assign(payload, { fuel: g('fuel'), unit: g('unit'), use: g('use'), asset: g('asset'), scope3_category: g('scope3_category') });
    if (kind !== 'waste' && val('doc')) { const d = S.docs.find((x) => x.id === val('doc')); if (d) payload.evidence = { id: d.name, hash: d.sha256, user_confirmed: d.status === 'confirmed' }; }
    try {
      const r = editing ? await api('PUT', orgUrl(`/records/${record.id}`), payload) : await api('POST', orgUrl('/records'), payload);
      m.close();
      toast(editing ? 'Record updated.' : `Record saved${r.warnings?.length ? '. Note: ' + r.warnings.map((w) => w.message).join(' ') : '.'}`);
      onSaved?.(r);
    } catch (e) {
      save.classList.remove('loading');
      put(errBox, h('div', { class: 'banner err', role: 'alert' }, icon('alert', 16), h('span', {}, e.data?.errors ? e.data.errors.map((x) => x.message).join(' ') : e.message)));
    }
  } });
  const m = modal({ title: editing ? `Edit record ${record.id}` : 'Add activity', size: 'md', body: [kindSel, errBox, body], footer: [btn('Cancel', { onclick: () => m.close() }), save] });
  void presetDoc;
}
