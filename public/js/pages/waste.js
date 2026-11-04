import { h, field, label, select, fmt, fmtT, debounce, toast, badge, add } from '../dom.js';
import { S, api, loadOrg, recompute, safe } from '../state.js';
import { refreshAll } from '../session.js';
import { stageFlow } from '../flow.js';
import { ring } from '../charts.js';

export function render(root) {
  const ind = S.industry, W = S.waste;
  const setNum = (obj, key, v) => { if (v === '') delete obj[key]; else obj[key] = Number(v); };
  const refs = new Map(); // "stage/stream" -> tonnes input, to show the live estimate as placeholder
  let selected = null;

  const summaryBox = h('div', { class: 'stats' });
  const diagramBox = h('div');
  const detailBox = h('div', { class: 'detail' });
  const findingsBox = h('div');
  const saveState = h('span', { class: 'muted', role: 'status' });

  const markDirty = () => { S.dirty = true; saveState.textContent = 'Unsaved changes - preview is live'; live(); };
  const live = debounce(safe(async () => { await recompute(); paintLive(); }), 280);

  function paintLive() {
    const w = S.out?.result.waste;
    if (!w) return;
    const sm = w.chain.summary;
    summaryBox.replaceChildren(
      stat(fmt(sm.waste_per_t_final_product, 2), 't waste per t product'), stat(fmtT(sm.total_waste_t_known), 't waste known'), stat(fmtT(sm.hazardous_t), 't hazardous'),
      h('div', { class: 'stat' }, ring(w.brsr.recovery_rate ?? 0, 'Recovery rate'), h('span', {}, 'recovered')),
      stat(String(sm.streams_requiring_measurement), sm.streams_requiring_measurement ? 'streams to measure' : 'all streams quantified', sm.streams_requiring_measurement ? 'warn' : 'ok'));
    diagramBox.replaceChildren(stageFlow(w.chain, { onSelect: select_, selected }));
    for (const s of w.chain.stages) for (const x of s.streams) {
      const inp = refs.get(`${s.id}/${x.stream_id}`);
      if (inp && inp.value === '') inp.placeholder = x.tonnes == null ? 'weigh it' : `~${fmtT(x.tonnes)} est.`;
    }
    const fs = w.findings.filter((f) => f.severity === 'error' || f.severity === 'warning');
    findingsBox.replaceChildren(fs.length ? h('div', { class: 'card' }, h('h3', {}, `Checks (${fs.length})`), fs.map((f) => h('div', { class: `msg ${f.severity}` }, h('b', {}, f.code), ' ', f.message))) : h('div', { class: 'card ok-card' }, 'All waste checks pass.'));
    paintDetail();
  }

  function select_(key) {
    selected = key;
    const row = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (row) { row.closest('details')?.setAttribute('open', ''); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1400); row.querySelector('input')?.focus({ preventScroll: true }); }
    paintLive();
  }

  function paintDetail() {
    detailBox.replaceChildren();
    if (!selected) { add(detailBox, h('p', { class: 'muted' }, 'Click a block in the diagram to see what it is and what the rules say.')); return; }
    const [sid, wid] = selected.split('/');
    const st = ind.stages.find((s) => s.id === sid), ex = st?.streams.find((x) => x.stream_id === wid);
    const live_ = S.out.result.waste.chain.stages.find((s) => s.id === sid)?.streams.find((x) => x.stream_id === wid);
    if (!ex) return;
    add(detailBox, h('h4', {}, ex.label), h('p', {}, ex.class_label, ' ', ex.hazardous ? badge('hazardous', 'haz') : badge('non-hazardous'), ex.hvle ? badge('HVLE', 'est') : null),
      h('p', { class: 'muted' }, `Stage: ${ex.stage_name}. BRSR line: ${S.catalog.brsr_categories[ex.brsr]}. Usual route: ${ex.default_route.replace(/_/g, ' ')}.`),
      live_?.tonnes != null ? h('p', {}, `${fmt(live_.tonnes, 1)} t `, badge(live_.basis.replace(/_/g, ' '), live_.basis === 'measured' ? 'meas' : 'est'), live_.range ? ` range ${fmt(live_.range.min, 0)} to ${fmt(live_.range.max, 0)} t` : '') : h('p', {}, badge('measurement required', 'haz')),
      ex.reg_item ? h('p', { class: 'muted' }, `${ex.reg_item} - ${ex.ref_confidence} source, confirm against the Gazette text.`) : null, ex.note ? h('p', { class: 'muted' }, ex.note) : null,
      ex.regulations.map((r) => h('p', { class: 'muted' }, `Rule: ${r.name}${r.verified ? '' : ' (not yet verified in this tool)'}`)));
  }

  // ---- stage editors
  const stageCards = ind.stages.map((st, idx) => {
    const sd = (W.stages[st.id] ??= {});
    sd.wastes ??= {}; sd.process_emissions ??= [];
    const rows = st.streams.map((s) => {
      const w = (sd.wastes[s.stream_id] ??= {});
      const routes = S.catalog.routes.filter((r) => !r.prohibited && (!s.hazardous || r.hazardous_ok));
      const key = `${st.id}/${s.stream_id}`;
      const tonnes = h('input', { type: 'number', min: '0', step: 'any', inputmode: 'decimal', 'aria-label': `${s.label} tonnes`, value: w.tonnes ?? '', oninput: (e) => { setNum(w, 'tonnes', e.target.value); markDirty(); } });
      refs.set(key, tonnes);
      return h('tr', { 'data-key': key },
        h('td', {}, h('b', {}, s.label), ' ', s.hazardous ? badge('hazardous', 'haz') : null, s.hvle ? badge('HVLE', 'est') : null, h('div', { class: 'muted' }, s.class_label), s.note ? h('div', { class: 'muted' }, s.note) : null),
        h('td', { class: 'muted' }, s.benchmark ? `typ. ${s.benchmark.typ} t/t (${s.benchmark.min}-${s.benchmark.max})` : 'no benchmark: weigh it'),
        h('td', {}, tonnes),
        h('td', {}, select(routes.map((r) => [r.id, r.label]), w.route ?? s.default_route, { 'aria-label': `${s.label} route`, onchange: (e) => { w.route = e.target.value; markDirty(); } })),
        h('td', {}, select([['offsite', 'Off-site'], ['onsite', 'On-site']], w.location ?? 'offsite', { 'aria-label': `${s.label} location`, onchange: (e) => { w.location = e.target.value; markDirty(); } })),
        h('td', {}, h('input', { 'aria-label': `${s.label} facility`, placeholder: s.hazardous ? 'Authorised facility / SPCB no.' : 'optional', value: w.facility ?? '', oninput: (e) => { w.facility = e.target.value; markDirty(); } })));
    });
    const pe = h('div');
    const drawPe = () => {
      pe.replaceChildren();
      if (st.process_emissions) pe.append(h('p', { class: 'muted' }, `Process emissions expected (${st.process_emissions.gases.join(', ')}). ${st.process_emissions.note}${st.process_default ? ' Left blank, a default is used: ' + st.process_default.basis : ''}`));
      sd.process_emissions.forEach((p, i) => pe.append(h('div', { class: 'row' },
        label('Gas', select(['CO2', 'CF4', 'C2F6', 'CH4', 'N2O', 'SF6'].map((g) => [g, g]), p.gas ?? 'CO2', { onchange: (e) => { p.gas = e.target.value; markDirty(); } })),
        label('Amount (kg)', h('input', { type: 'number', min: '0', step: 'any', value: p.kg ?? '', oninput: (e) => { p.kg = e.target.value === '' ? undefined : Number(e.target.value); markDirty(); } })),
        label('How derived', h('input', { value: p.basis_note ?? '', oninput: (e) => { p.basis_note = e.target.value; markDirty(); } })),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { sd.process_emissions.splice(i, 1); drawPe(); markDirty(); } }, 'Remove'))));
      if (st.process_emissions) pe.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { sd.process_emissions.push({ gas: 'CO2' }); drawPe(); } }, 'Add process emission'));
    };
    drawPe();
    return h('details', { class: 'card stage-card', open: idx === 0 || null },
      h('summary', {}, h('b', {}, `Stage ${idx + 1}: ${st.name}`), h('span', { class: 'muted' }, ` makes ${st.product}`)),
      h('div', { class: 'grid' },
        field(`${st.product} produced (t, if measured)`, { type: 'number', min: '0', step: 'any', value: sd.product_t ?? '', oninput: (e) => { setNum(sd, 'product_t', e.target.value); markDirty(); } }),
        field(`${st.chain_input.label} used (t, if measured)`, { type: 'number', min: '0', step: 'any', value: sd.chain_input_t ?? '', oninput: (e) => { setNum(sd, 'chain_input_t', e.target.value); markDirty(); } })),
      h('div', { class: 'tablewrap' }, h('table', {}, h('tr', {}, ...['Waste stream', 'Benchmark', 'Tonnes', 'Where it goes', 'Location', 'Facility'].map((x) => h('th', {}, x))), rows)), pe);
  });

  // ---- identify helper
  const identOut = h('div');
  const ident = h('div', { class: 'card' }, h('h3', {}, 'What is this waste called?'),
    h('div', { class: 'row' }, label('Describe it', h('input', { id: 'ident', placeholder: 'e.g. pot lining, dross, ETP sludge' })),
      h('button', { class: 'btn', type: 'button', onclick: safe(async () => {
        const r = await api('POST', '/api/waste/identify', { text: document.getElementById('ident').value, industry: S.org.inventory.organisation.industry });
        identOut.replaceChildren(...(r.matches.length ? r.matches.map((m) => h('button', { class: 'chip', type: 'button', onclick: () => select_(`${m.stage}/${m.stream_id}`) }, `${m.stage_name}: ${m.label}`, h('small', {}, ` ${m.class_label}${m.hazardous ? ' - HAZARDOUS' : ''}`))) : [h('p', { class: 'muted' }, 'No match in this industry. Add it under "Other site-wide waste".')]));
      }) }, 'Find')), identOut);

  // ---- general waste
  const gen = h('div');
  const drawGen = () => {
    gen.replaceChildren(...W.general_waste.map((g, i) => h('div', { class: 'row gen' },
      label('Waste', h('input', { value: g.label ?? '', oninput: (e) => { g.label = e.target.value; markDirty(); } })),
      label('Type', select(S.catalog.waste_classes.map((c) => [c.id, c.label]), g.waste_class ?? 'paper_cardboard', { onchange: (e) => { g.waste_class = e.target.value; markDirty(); } })),
      label('Tonnes', h('input', { type: 'number', min: '0', step: 'any', value: g.tonnes ?? '', oninput: (e) => { g.tonnes = e.target.value === '' ? undefined : Number(e.target.value); markDirty(); } })),
      label('Where it goes', select(S.catalog.routes.filter((r) => !r.prohibited).map((r) => [r.id, r.label]), g.route ?? 'recycling', { onchange: (e) => { g.route = e.target.value; markDirty(); } })),
      label('Location', select([['offsite', 'Off-site'], ['onsite', 'On-site']], g.location ?? 'offsite', { onchange: (e) => { g.location = e.target.value; markDirty(); } })),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { W.general_waste.splice(i, 1); drawGen(); markDirty(); } }, 'Remove'))),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { W.general_waste.push({ waste_class: 'paper_cardboard', route: 'recycling', location: 'offsite' }); drawGen(); } }, '+ Add other waste (canteen, e-waste, packaging...)'));
  };
  drawGen();

  const saveBtn = h('button', { class: 'btn primary', onclick: safe(async () => {
    await api('PUT', `/api/orgs/${S.creds.id}/waste`, W); await refreshAll(); S.dirty = false; saveState.textContent = 'Saved'; toast('Waste data saved.');
  }) }, 'Save waste data');

  add(root, 
    h('div', { class: 'between' }, h('div', {}, h('h2', {}, ind.label), h('p', { class: 'muted' }, 'Waste is created at specific stages. Type what you weighed and watch the flow update; blanks are estimated from labelled benchmarks, or shown as needing measurement, never zero.')), h('div', { class: 'savebar' }, saveState, saveBtn)),
    summaryBox,
    h('div', { class: 'card' }, h('div', { class: 'between' }, h('h3', {}, 'Mass flow through the plant'),
      field(`Final product (t) - ${ind.final_product}`, { type: 'number', min: '0', step: 'any', value: W.final_product_t ?? '', oninput: (e) => { setNum(W, 'final_product_t', e.target.value); markDirty(); } })), diagramBox, detailBox),
    findingsBox, ...stageCards, ident,
    h('div', { class: 'card' }, h('h3', {}, 'Other site-wide waste'), gen,
      h('div', { class: 'grid' }, field('Disposal site rainfall (mm/yr)', { type: 'number', min: '0', value: W.disposal_site.rainfall_mm ?? '', oninput: (e) => { setNum(W.disposal_site, 'rainfall_mm', e.target.value); markDirty(); } }),
        field('Landfill methane captured (0 to 1)', { type: 'number', min: '0', max: '1', step: '0.05', value: W.disposal_site.methane_recovered_fraction ?? '', oninput: (e) => { setNum(W.disposal_site, 'methane_recovered_fraction', e.target.value); markDirty(); } }))));
  paintLive();
  if (!S.out) live();
}
const stat = (v, l, kind = '') => h('div', { class: `stat ${kind}` }, h('b', {}, v), h('span', {}, l));
