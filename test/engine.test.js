import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from '../src/engine/units.js';
import { toCo2e, gwpOf } from '../src/engine/gwp.js';
import { calcFuel } from '../src/engine/scope1.js';
import { calcElectricity } from '../src/engine/scope2.js';
import { runInventory } from '../src/engine/calculate.js';
import { validateInventory, fyBounds } from '../src/engine/validate.js';
import { loadRegister, assertFactorRecord } from '../src/engine/factors.js';
import { sampleAluminiumUnit } from '../src/sample.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} +/- ${tol}, got ${a}`);

test('units: converts within a dimension and rejects bad input', () => {
  assert.equal(convert(2, 'kL', 'L'), 2000);
  assert.equal(convert(1, 'MWh', 'kWh'), 1000);
  close(convert(3.6, 'GJ', 'kWh'), 1000, 1e-9);
  assert.throws(() => convert(1, 'L', 'kWh'), /Cannot convert/);
  assert.throws(() => convert(-1, 'kg', 't'), /negative/);
  assert.throws(() => convert(NaN, 'kg', 't'), /finite/);
});

test('financial year bounds follow the Indian April-March year', () => {
  assert.deepEqual(fyBounds('2026-27'), { start: '2026-04-01', end: '2027-03-31', reportingYear: 2026 });
  assert.throws(() => fyBounds('2026-28'), /consecutive/);
  assert.throws(() => fyBounds('2026'), /look like/);
});

test('GWP sets are recorded and switchable', () => {
  assert.equal(gwpOf('CH4', 'AR6'), 27.9);
  assert.equal(gwpOf('N2O', 'AR5'), 265);
  assert.equal(toCo2e({ CO2: 10, CH4: 1 }, 'AR4'), 35);
  assert.throws(() => gwpOf('XYZ'), /No AR6 GWP/);
});

test('proposal worked example: electricity matches, fuels are CO2-only in the proposal', () => {
  const e = calcElectricity({ grid_import_kwh: 5000 }, { periodEnd: '2024-03-31' });
  close(e.locationKg, 3580, 1e-6, 'electricity 5000 kWh x 0.716');

  // Independent reference: diesel 400 L x 0.84 kg/L = 336 kg; x 43 GJ/t = 14.448 GJ = 0.014448 TJ
  const d = calcFuel({ fuel: 'diesel', use: 'stationary', quantity: 400, unit: 'L' }, { gwpSet: 'AR6', periodEnd: '2027-03-31' });
  const tj = 0.336 * 43 / 1000;
  const expected = tj * 74100 + tj * 3 * 27.9 + tj * 0.6 * 273;
  close(d.co2eKg, expected, 1e-6);
  assert.ok(d.co2eKg > 1056 - 5 && d.co2eKg < 1100, 'close to but not identical to the proposal CO2-only 1056 kg');

  const p = calcFuel({ fuel: 'petrol', use: 'mobile', quantity: 600, unit: 'L' }, { gwpSet: 'AR6', periodEnd: '2027-03-31' });
  assert.ok(p.co2eKg > 1386, 'full CO2e must exceed the CO2-only 1386 kg once CH4/N2O are included');
});

test('fuel: mass/volume handling and rejects volume for fuels without density', () => {
  const kg = calcFuel({ fuel: 'lpg', use: 'stationary', quantity: 100, unit: 'kg' }, { gwpSet: 'AR6', periodEnd: '2027-03-31' });
  close(kg.gases.CO2, 100 / 1000 * 47.3 / 1000 * 63100, 1e-6);
  assert.throws(() => calcFuel({ fuel: 'coal', use: 'stationary', quantity: 10, unit: 'L' }, { gwpSet: 'AR6' }), /by volume/);
  assert.throws(() => calcFuel({ fuel: 'unobtainium', use: 'stationary', quantity: 1, unit: 'kg' }, { gwpSet: 'AR6' }), /No factor/);
  const ov = calcFuel({ fuel: 'coal', use: 'stationary', quantity: 1, unit: 't', ncv_override_gj_per_t: 19.6 }, { gwpSet: 'AR6', periodEnd: '2027-03-31' });
  assert.ok(ov.warnings.some((w) => w.code === 'NCV_OVERRIDE'));
});

test('biogenic CO2 is reported separately, not in Scope 1', () => {
  const r = calcFuel({ fuel: 'biomass_wood', use: 'stationary', quantity: 10, unit: 't' }, { gwpSet: 'AR6', periodEnd: '2027-03-31' });
  assert.ok(r.biogenicCo2Kg > 0);
  assert.equal(r.gases.CO2, undefined);
  assert.ok(r.co2eKg > 0, 'CH4 and N2O are still counted');
});

test('electricity: only grid imports carry the grid factor; solar is reconciled, not multiplied', () => {
  const r = calcElectricity({ grid_import_kwh: 1000, solar_generated_kwh: 500, solar_self_consumed_kwh: 400, solar_exported_kwh: 100 }, { periodEnd: '2024-03-31' });
  close(r.locationKg, 716, 1e-9);
  assert.equal(r.siteConsumptionKwh, 1400);
  assert.equal(r.warnings.length, 0);
  const bad = calcElectricity({ grid_import_kwh: 1000, solar_generated_kwh: 100, solar_self_consumed_kwh: 90, solar_exported_kwh: 50 }, { periodEnd: '2024-03-31' });
  assert.ok(bad.warnings.some((w) => w.code === 'SOLAR_RECONCILE'));
});

test('electricity: market-based reduces only by contractual RE; stale factor period warns', () => {
  const r = calcElectricity({ grid_import_kwh: 1000, contractual_re_kwh: 400 }, { periodEnd: '2024-03-31' });
  close(r.marketKg, 600 * 0.716, 1e-9);
  close(r.locationKg, 716, 1e-9);
  const stale = calcElectricity({ grid_import_kwh: 1000 }, { periodEnd: '2027-03-31' });
  assert.ok(stale.warnings.some((w) => w.code === 'FACTOR_PERIOD'), 'v20 factor does not cover FY2026-27');
  const td = calcElectricity({ grid_import_kwh: 1000, td_loss_pct: 10 }, { periodEnd: '2024-03-31' });
  close(td.tdLossKg, 71.6, 1e-9);
});

test('factor register: every record has provenance; validated needs a reviewer', () => {
  const reg = loadRegister({ includeLocal: false });
  assert.ok(reg.factors.length >= 10);
  assert.ok(reg.factors.every((f) => f.status === 'provisional'), 'nothing may be shipped as validated without a named reviewer');
  assert.throws(() => assertFactorRecord({ ...reg.factors[0], status: 'validated' }), /reviewer/);
  assert.throws(() => assertFactorRecord({ ...reg.factors[0], source: { document: 'x' } }), /source needs/);
});

test('validation: overlap, duplicate evidence, period, boundary and scope 3 category', () => {
  const inv = sampleAluminiumUnit();
  inv.activities.push({ ...inv.activities[0], id: 'E-APR-2', evidence: { id: 'other', hash: 'sha-e-apr' } });
  inv.activities.push({ id: 'X', type: 'electricity', facility_id: 'F1', meter_id: 'M1', period: { start: '2025-01-01', end: '2025-01-31' }, grid_import_kwh: 1 });
  inv.activities.push({ id: 'Y', type: 'fuel', facility_id: 'F9', fuel: 'diesel', ownership: 'third_party', quantity: 1, unit: 'L', period: { start: '2026-07-01', end: '2026-07-31' } });
  const { errors } = validateInventory(inv);
  const codes = errors.map((e) => e.code);
  assert.ok(codes.includes('PERIOD_OVERLAP'));
  assert.ok(codes.includes('DUPLICATE_EVIDENCE'));
  assert.ok(codes.includes('OUTSIDE_PERIOD'));
  assert.ok(codes.includes('ACTIVITY_FACILITY'));
  assert.ok(codes.includes('SCOPE3_CATEGORY'));
  const bad = sampleAluminiumUnit(); delete bad.organisation.consolidation_approach; bad.organisation.facilities = [];
  assert.ok(validateInventory(bad).errors.length >= 2);
});

test('inventory is deterministic and hash changes with inputs', () => {
  const a = runInventory(sampleAluminiumUnit());
  const b = runInventory(sampleAluminiumUnit());
  assert.equal(a.manifest.result_hash, b.manifest.result_hash);
  assert.equal(a.manifest.input_hash, b.manifest.input_hash);
  const changed = sampleAluminiumUnit(); changed.activities[0].grid_import_kwh += 1;
  const c = runInventory(changed);
  assert.notEqual(c.manifest.result_hash, a.manifest.result_hash);
  assert.notEqual(c.manifest.input_hash, a.manifest.input_hash);
});

test('totals reconcile: scope sums equal line sums; scope 3 never silently zero', () => {
  const { result } = runInventory(sampleAluminiumUnit());
  const total = result.lines.reduce((s, l) => s + l.co2eKg, 0);
  close(result.totals_kg.scope1_kg + result.totals_kg.scope2_location_kg + result.totals_kg.scope3_assessed_kg, total, 1e-6);
  assert.equal(result.scope3_screening.length, 15);
  assert.ok(result.scope3_screening.filter((s) => s.status === 'not_assessed').length >= 10);
  assert.ok(result.exclusions.some((x) => /Scope 3 category 6/.test(x)));
  assert.equal(result.scope3_screening.find((s) => s.category === 1).status, 'excluded');
  const gasSum = Object.entries(result.by_gas_kg).reduce((s, [g, kg]) => s + kg * gwpOf(g, 'AR6'), 0);
  close(gasSum, total, 1e-3, 'gas breakdown must reproduce total CO2e');
});

test('report eligibility: provisional factors block reviewed status; errors block self-declared', () => {
  const ok = runInventory(sampleAluminiumUnit());
  assert.ok(ok.report_eligibility.allowed_statuses.includes('self_declared'));
  assert.ok(!ok.report_eligibility.allowed_statuses.includes('internally_reviewed'));
  assert.ok(!ok.report_eligibility.allowed_statuses.includes('externally_assured'));
  assert.ok(ok.report_eligibility.provisional_factors.length > 0);

  const broken = sampleAluminiumUnit();
  broken.activities.push({ ...broken.activities[0], id: 'DUP', evidence: { id: 'again', hash: 'sha-e-apr' } });
  const r = runInventory(broken);
  assert.deepEqual(r.report_eligibility.allowed_statuses, ['draft']);
  assert.ok(r.report_eligibility.blocking.length > 0);
});

test('GWP set changes totals and is recorded in the manifest', () => {
  const a6 = runInventory(sampleAluminiumUnit());
  const inv = sampleAluminiumUnit(); inv.gwp_set = 'AR4';
  const a4 = runInventory(inv);
  assert.notEqual(a6.result.totals_kg.scope1_kg, a4.result.totals_kg.scope1_kg);
  assert.equal(a4.manifest.gwp.set, 'AR4');
});
