import { h, put, fmt, fmtT, debounce, countUp, badge, add } from '../dom.js';
import { S, api, safe, poorRoutes } from '../state.js';
import { C } from '../charts.js';

const DIVERT = { plastic: 'recycling', paper_cardboard: 'recycling', metal_scrap: 'recycling', textile: 'recycling', e_waste: 'recycling', battery: 'recycling', used_oil: 'recycling', food_organic: 'composting', garden: 'composting', organic_sludge: 'composting', inorganic_mineral: 'other_recovery' };

export function render(root) {
  const lv = { solar_kwp_added: 0, diesel_genset_cut: 0, contractual_re_share: 0, shifts: {} };
  const result = h('div', { class: 'card sticky' });
  const r = S.out.result;
  const elec = S.org.inventory.activities.filter((a) => a.type === 'electricity' && !a.voided);
  const imports = elec.reduce((s, a) => s + (a.grid_import_kwh ?? 0), 0);
  const days = Math.min(elec.reduce((s, a) => s + (Date.parse(a.period.end) - Date.parse(a.period.start)) / 86400000 + 1, 0), 365) || 365;
  const maxKwp = imports ? Math.max(Math.ceil(((imports * 365) / days / 1400) * 1.2 / 10) * 10, 10) : 0;
  const hasDiesel = S.org.inventory.activities.some((a) => a.type === 'fuel' && a.fuel === 'diesel' && a.use === 'stationary' && a.ownership === 'owned' && !a.voided);

  const candidates = (r.waste?.lines ?? []).filter((l) => typeof l.tonnes === 'number' && l.tonnes > 0 && DIVERT[l.waste_class] && !S.catalog.waste_classes.find((c) => c.id === l.waste_class)?.hazardous
    && (l.splits.some((s) => poorRoutes.has(s.route)) || (l.waste_class === 'inorganic_mineral' && l.tonnes > 50)));

  const slider = (title, hint, key, max, step, unit, store = lv, enabled = true) => {
    const out = h('output', {}, `0 ${unit}`);
    const input = h('input', { type: 'range', min: 0, max, step, value: store[key] ?? 0, disabled: enabled ? null : true, 'aria-label': title, oninput: (e) => { store[key] = Number(e.target.value); out.textContent = `${fmt(store[key], 0)} ${unit}`; run(); } });
    return h('div', { class: 'lever' }, h('div', { class: 'between' }, h('b', {}, title), out), input, h('span', { class: 'muted' }, hint));
  };

  const run = debounce(safe(async () => {
    const levers = {
      solar_kwp_added: lv.solar_kwp_added, diesel_genset_cut: lv.diesel_genset_cut / 100, contractual_re_share: lv.contractual_re_share / 100,
      route_shifts: Object.entries(lv.shifts).filter(([, v]) => v.share > 0).map(([k, v]) => ({ stage: k.split('/')[0], stream_id: k.split('/')[1], to_route: v.to, share: v.share / 100, from_routes: v.from })),
    };
    const sc = await api('POST', `/api/orgs/${S.creds.id}/scenario`, { levers });
    paint(sc);
  }), 220);

  const row = (name, base, scen, color) => {
    const m = Math.max(base, scen, 1e-9);
    return h('div', { class: 'cmp' }, h('span', { class: 'cmp-n' }, name),
      h('div', { class: 'cmp-b' }, h('i', { class: 'b0', style: `width:${(base / m) * 100}%` }), h('i', { class: 'b1', style: `width:${(scen / m) * 100}%;background:${color}` })),
      h('span', { class: 'cmp-v' }, `${fmtT(base)} → ${fmtT(scen)} t`));
  };
  function paint(sc) {
    const b = sc.baseline.totals_t, s = sc.scenario.totals_t, d = sc.reduction_t;
    const big = h('b', { class: 'big' }, '0');
    put(result, h('h3', {}, 'Effect on your footprint'),
      h('div', { class: 'delta' }, big, h('span', {}, ' tCO2e less in this inventory (Scope 1 + 2, location-based)')),
      h('p', { class: 'muted' }, 'Computed by re-running the real engine on a copy of your data, over the period you have recorded. Forward-looking: your inventory is unchanged. For a yearly view with costs, see Actions.'),
      row('Scope 1', b.scope1_t, s.scope1_t, C.s1), row('Scope 2', b.scope2_location_t, s.scope2_location_t, C.s2), row('Scope 3 (assessed)', b.scope3_assessed_t, s.scope3_assessed_t, C.s3),
      lv.contractual_re_share ? h('p', {}, badge('market-based', 'est'), ` Scope 2 market-based: ${fmtT(b.scope2_market_t)} → ${fmtT(s.scope2_market_t)} t (${fmtT(d.scope2_market)} t less). Location-based, used for the headline, does not change.`) : null,
      sc.delta_recovery_pts != null && Math.abs(sc.delta_recovery_pts) > 0.005 ? h('p', {}, badge('waste', 'meas'), ` Recovery rate ${fmt(sc.baseline.recovery_rate * 100, 1)}% → ${fmt(sc.scenario.recovery_rate * 100, 1)}% (${sc.delta_recovery_pts > 0 ? '+' : ''}${fmt(sc.delta_recovery_pts, 1)} points)`) : null,
      sc.notes.map((n) => h('p', { class: 'msg warning' }, n)));
    countUp(big, d.scope1_2_location, { digits: 2 });
  }

  const shiftRows = candidates.map((l) => {
    const key = `${l.stage}/${l.stream_id}`;
    const poor = l.splits.filter((s) => poorRoutes.has(s.route)).map((s) => s.route);
    const from = poor.length ? poor : l.splits.map((s) => s.route);
    const store = (lv.shifts[key] ??= { share: 0, to: DIVERT[l.waste_class], from });
    return slider(`${l.label}`, `${fmtT(l.tonnes)} t now via ${from.map((x) => x.replace(/_/g, ' ')).join(', ')}. Move to ${store.to.replace(/_/g, ' ')}${l.waste_class === 'inorganic_mineral' ? ' (diversion only: no methane in this material)' : ''}.`, 'share', 100, 5, '%', store);
  });

  add(root, h('div', { class: 'lead-sm' }, h('h2', {}, 'What if...?'), h('p', { class: 'muted' }, 'Move the levers and see what changes. Nothing here is saved or reported.')),
    h('div', { class: 'cols wide-left' },
      h('div', { class: 'card' }, h('h3', {}, 'Energy'),
        slider('Rooftop solar added', imports ? `Up to ${maxKwp} kWp. Yield assumed 1,400 kWh/kWp/yr. Output is capped at your grid imports.` : 'Add an electricity bill first.', 'solar_kwp_added', maxKwp || 10, 5, 'kWp', lv, !!imports),
        slider('Cut in stationary diesel', hasDiesel ? 'Load scheduling, right-sized gensets, grid reliability.' : 'No stationary diesel recorded.', 'diesel_genset_cut', 100, 5, '%', lv, hasDiesel),
        slider('Renewable electricity under contract', 'Affects market-based Scope 2 only, and only with documented contracts.', 'contractual_re_share', 100, 5, '%', lv, !!imports),
        h('h3', {}, 'Waste routes'), shiftRows.length ? shiftRows : h('p', { class: 'muted' }, 'No waste streams on weak routes. Good.')),
      result));
  paint({ baseline: { totals_t: r.totals_t }, scenario: { totals_t: r.totals_t }, reduction_t: { scope1_2_location: 0, scope2_market: 0 }, notes: [], delta_recovery_pts: null });
}
