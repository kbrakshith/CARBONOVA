import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInventory } from '../src/engine/calculate.js';
import { applyScenario, runScenario } from '../src/engine/scenario.js';
import { recommendations } from '../src/engine/reduction.js';
import { sampleAluminiumUnit } from '../src/sample.js';

const close = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m ?? ''} expected ${b} +/- ${tol}, got ${a}`);

test('scenario does not mutate the original inventory and is deterministic', () => {
  const inv = sampleAluminiumUnit();
  const before = JSON.stringify(inv);
  const a = runScenario(inv, { solar_kwp_added: 100 });
  const b = runScenario(inv, { solar_kwp_added: 100 });
  assert.equal(JSON.stringify(inv), before);
  assert.equal(a.result_hash, b.result_hash);
});

test('solar displaces grid imports: reduction equals displaced kWh x grid factor, capped at imports', () => {
  const inv = sampleAluminiumUnit();
  const imports = inv.activities.filter((x) => x.type === 'electricity').reduce((s, x) => s + x.grid_import_kwh, 0);
  const days = 61; // April + May
  const r = runScenario(inv, { solar_kwp_added: 100, solar_yield_kwh_per_kwp_yr: 1400 });
  const kwh = 100 * 1400 * days / 365;
  close(r.reduction_t.scope2_location, kwh * 0.716 / 1000, 1e-6);
  const huge = runScenario(inv, { solar_kwp_added: 1e6 });
  close(huge.scenario.totals_t.scope2_location_t, 0, 1e-6, 'cannot displace more than imports');
  assert.ok(huge.notes.some((n) => /capped/.test(n)));
  assert.equal(runScenario(inv, {}).reduction_t.scope1_2_location, 0);
});

test('contractual renewable share changes market-based only', () => {
  const r = runScenario(sampleAluminiumUnit(), { contractual_re_share: 0.5 });
  assert.equal(r.reduction_t.scope2_location, 0);
  close(r.reduction_t.scope2_market, r.baseline.totals_t.scope2_market_t * 0.5, 1e-3);
});

test('diesel genset cut reduces only owned stationary diesel', () => {
  const inv = sampleAluminiumUnit();
  const r = runScenario(inv, { diesel_genset_cut: 0.5 });
  const base = runInventory(inv).result.lines.find((l) => l.activity_id === 'D-APR').co2eKg;
  close(r.reduction_t.scope1, base * 0.5 / 1000, 1e-6);
  const third = runInventory(applyScenario(inv, { diesel_genset_cut: 1 }).inventory).result.lines.find((l) => l.activity_id === 'T-APR');
  assert.ok(third.co2eKg > 0, 'third-party diesel untouched');
});

test('route shifts: moving food waste from landfill to composting is recomputed by the real engine', () => {
  const inv = sampleAluminiumUnit();
  inv.waste.general_waste.push({ id: 'sweepings', label: 'Food-soiled waste', waste_class: 'food_organic', tonnes: 100, route: 'landfill_managed', location: 'offsite' });
  const base = runInventory(inv).result;
  const lf = base.lines.find((l) => l.activity_id === 'waste:general/sweepings/landfill_managed');
  assert.ok(lf.co2eKg > 0, 'landfilled food waste emits methane');
  const r = runScenario(inv, { route_shifts: [{ stream_id: 'sweepings', stage: 'general', to_route: 'composting', share: 1 }] });
  assert.ok(r.reduction_t.scope3_assessed > 0 || r.reduction_t.scope1 !== 0);
  const half = runScenario(inv, { route_shifts: [{ stream_id: 'sweepings', stage: 'general', to_route: 'composting', share: 0.5, from_routes: ['landfill_managed'] }] });
  const after = runInventory(applyScenario(inv, { route_shifts: [{ stream_id: 'sweepings', stage: 'general', to_route: 'composting', share: 0.5 }] }).inventory).result;
  close(after.waste.lines.find((l) => l.stream_id === 'sweepings').tonnes, 100, 1e-9, 'mass is conserved when shifting');
  assert.notEqual(half.result_hash, r.result_hash);
  assert.throws(() => runScenario(inv, { route_shifts: [{ stream_id: 'sweepings', to_route: 'teleport' }] }), /Unknown route/);
});

test('stage stream route shift keeps tonnes and improves recovery rate', () => {
  const inv = sampleAluminiumUnit();
  const r = runScenario(inv, { route_shifts: [{ stream_id: 'red_mud', stage: 'refining', to_route: 'other_recovery', share: 0.2 }] });
  assert.ok(r.delta_recovery_pts > 0);
  assert.equal(r.reduction_t.scope1_2_location, 0, 'inorganic residue: diversion, not methane');
});

test('recommendations: ranked, costed ones first, assumptions echoed, forward-looking', () => {
  const inv = sampleAluminiumUnit();
  inv.waste.general_waste.push({ id: 'pack', label: 'Plastic packaging', waste_class: 'plastic', tonnes: 5, route: 'other_disposal', location: 'offsite' });
  const rec = recommendations(inv, { tariff_inr_per_kwh: 9 });
  assert.equal(rec.forward_looking, true);
  assert.equal(rec.assumptions.tariff_inr_per_kwh, 9);
  const solar = rec.actions.find((a) => a.id === 'solar');
  assert.ok(solar.payback_years > 0 && solar.upfront_inr > 0);
  assert.ok(solar.range_tco2e[0] < solar.annual_tco2e_avoided && solar.annual_tco2e_avoided < solar.range_tco2e[1]);
  const costed = rec.actions.filter((a) => a.payback_years != null);
  assert.ok(costed.length >= 2 && rec.actions.slice(0, costed.length).every((a) => a.payback_years != null), 'costed actions rank first');
  assert.deepEqual(costed.map((a) => a.payback_years), costed.map((a) => a.payback_years).sort((a, b) => a - b), 'ordered by payback');
  assert.ok(rec.actions.every((a) => a.effort && a.confidence && typeof a.why === 'string'));
  assert.deepEqual(rec.actions.map((a) => a.rank), rec.actions.map((_, i) => i + 1));
  assert.ok(rec.actions.some((a) => a.category === 'waste' && a.diverted_t > 0));
  assert.ok(rec.actions.every((a) => a.assumptions));
  const none = recommendations({ ...inv, activities: [], waste: null });
  assert.equal(none.actions.length, 0);
});
