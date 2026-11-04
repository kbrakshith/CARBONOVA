import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fodSeries, fodLifetimeCh4Reference } from '../src/waste/fod.js';
import { treatmentEmissions } from '../src/waste/treatment.js';
import { computeStageChain } from '../src/waste/stageModel.js';
import { runWaste } from '../src/waste/index.js';
import { validateDeclaredWaste, identifyByText, expectedStreams } from '../src/waste/identify.js';
import { brsrWasteTable } from '../src/waste/brsr.js';
import { INDUSTRIES } from '../src/waste/industries.js';
import { WASTE_CLASSES, ROUTES, FOD_K } from '../src/waste/taxonomy.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} +/- ${tol}, got ${a}`);
const CTX = { gwpSet: 'AR6', reportingYear: 2026 };

test('FOD is genuinely time-dependent and conserves carbon', () => {
  const p = { deposits: [{ year: 2026, tonnes: 100 }], doc: 0.15, k: 0.4, mcf: 1.0, horizonYears: 200 };
  const res = fodSeries(p);
  const ref = fodLifetimeCh4Reference({ tonnes: 100, doc: 0.15, mcf: 1.0 });
  close(res.totalCh4T, ref, ref * 1e-9, 'lifetime CH4 must equal the closed form');
  assert.ok(res.series[0].ch4T < res.series[1].ch4T, 'peak is after the first (part) year');
  assert.ok(res.series[1].ch4T > res.series[5].ch4T, 'then decays');
  assert.ok(new Set(res.series.slice(0, 6).map((s) => s.ch4T.toFixed(9))).size === 6, 'not a flat factor x tonnes');
  const slow = fodSeries({ ...p, k: 0.035 });
  assert.ok(slow.firstYearCh4T < res.firstYearCh4T, 'slower decay emits less in year 1');
  close(slow.totalCh4T, ref, ref * 1e-3, 'but same lifetime total');
});

test('FOD: MCF scales output, recovery and oxidation reduce it, history adds', () => {
  const base = { deposits: [{ year: 2026, tonnes: 10 }], doc: 0.4, k: 0.07, mcf: 1 };
  const full = fodSeries(base).totalCh4T;
  close(fodSeries({ ...base, mcf: 0.4 }).totalCh4T, full * 0.4, full * 1e-6);
  close(fodSeries({ ...base, recoveredFraction: 0.5 }).totalCh4T, full * 0.5, full * 1e-6);
  close(fodSeries({ ...base, ox: 0.1 }).totalCh4T, full * 0.9, full * 1e-6);
  assert.ok(fodSeries({ ...base, deposits: [{ year: 2025, tonnes: 10 }, { year: 2026, tonnes: 10 }] }).totalCh4T > full * 1.99);
  assert.throws(() => fodSeries({ ...base, k: 0 }), /k must/);
  assert.throws(() => fodSeries({ ...base, mcf: 1.5 }), /MCF/);
});

test('treatment: route-specific results, never blended', () => {
  const compost = treatmentEmissions({ waste_class: 'food_organic', route: 'composting', tonnes_wet: 10 }, CTX);
  close(compost.gases.CH4, 40, 1e-9); // 4 kg CH4 per t wet (proposal + IPCC)
  close(compost.gases.N2O, 3, 1e-9);
  const ad = treatmentEmissions({ waste_class: 'food_organic', route: 'anaerobic_digestion', tonnes_wet: 10 }, CTX);
  close(ad.gases.CH4, 8, 1e-9); // 0.8 kg/t
  assert.ok(compost.co2eKg > ad.co2eKg);
  const lf = treatmentEmissions({ waste_class: 'food_organic', route: 'landfill_managed', tonnes_wet: 10, climate: 'tropical_wet' }, CTX);
  close(lf.gases.CH4, fodLifetimeCh4Reference({ tonnes: 10, doc: 0.15, mcf: 1 }) * 1000, 1e-3);
  assert.match(lf.method, /first-order decay/);
});

test('treatment: plastic incineration fossil CO2, inorganic landfill zero, bad class/route rejected', () => {
  const inc = treatmentEmissions({ waste_class: 'plastic', route: 'incineration', tonnes_wet: 1 }, CTX);
  close(inc.gases.CO2, 1000 * 1 * 0.75 * 1 * 44 / 12, 1e-6); // 2750 kg
  const red = treatmentEmissions({ waste_class: 'inorganic_mineral', route: 'secure_landfill', tonnes_wet: 500 }, CTX);
  assert.equal(red.co2eKg, 0);
  assert.match(red.method, /no biodegradable carbon/);
  const wrong = treatmentEmissions({ waste_class: 'plastic', route: 'composting', tonnes_wet: 1 }, CTX);
  assert.equal(wrong.assessed, false);
  assert.ok(wrong.warnings.some((w) => w.code === 'ROUTE_CLASS_MISMATCH'));
  const solvent = treatmentEmissions({ waste_class: 'hazardous_organic', route: 'incineration', tonnes_wet: 1 }, CTX);
  assert.equal(solvent.assessed, false, 'no carbon fraction: not assessed rather than invented');
  const solvent2 = treatmentEmissions({ waste_class: 'hazardous_organic', route: 'incineration', tonnes_wet: 1, carbon_fraction_override: 0.6 }, CTX);
  close(solvent2.gases.CO2, 1000 * 0.6 * 44 / 12, 1e-6);
  const ob = treatmentEmissions({ waste_class: 'plastic', route: 'open_burning', tonnes_wet: 1 }, CTX);
  assert.ok(ob.warnings.some((w) => w.code === 'PROHIBITED_ROUTE'));
  assert.ok(ob.gases.CH4 > 6);
  assert.throws(() => treatmentEmissions({ waste_class: 'nope', route: 'recycling', tonnes_wet: 1 }, CTX), /Unknown waste class/);
  assert.throws(() => treatmentEmissions({ waste_class: 'plastic', route: 'nope', tonnes_wet: 1 }, CTX), /Unknown treatment route/);
});

test('stage chain: aluminium back-calculation from final product (bauxite -> usable aluminium)', () => {
  const r = computeStageChain({ industry: 'aluminium', final_product_t: 1000 });
  const by = Object.fromEntries(r.stages.map((s) => [s.id, s]));
  close(by.casting.chain_input.tonnes, 1030, 1e-6);
  close(by.smelting.chain_input.tonnes, 1977.6, 1e-6); // alumina
  close(by.refining.chain_input.tonnes, 4944, 1e-6); // beneficiated bauxite
  close(by.mining.chain_input.tonnes, 5833.92, 1e-6); // run-of-mine
  const redMud = by.refining.streams.find((s) => s.stream_id === 'red_mud');
  close(redMud.tonnes, 1977.6 * 1.2, 1e-6);
  assert.equal(redMud.basis, 'estimated_benchmark');
  assert.ok(redMud.range.min < redMud.tonnes && redMud.tonnes < redMud.range.max);
  assert.equal(redMud.brsr, 'other_hazardous');
  const spl = by.smelting.streams.find((s) => s.stream_id === 'spl' || s.stream_id === 'spent_pot_lining');
  assert.equal(spl.hazardous, true);
  assert.equal(r.summary.complete, false, 'overburden and dregs have no benchmark');
  assert.equal(r.summary.streams_requiring_measurement, 2);
});

test('stage chain: streams with no benchmark are "measurement required", never zero', () => {
  const r = computeStageChain({ industry: 'aluminium', final_product_t: 1000 });
  const ob = r.stages[0].streams.find((s) => s.stream_id === 'overburden');
  assert.equal(ob.tonnes, null);
  assert.equal(ob.basis, 'measurement_required');
  assert.ok(r.warnings.some((w) => w.code === 'MEASUREMENT_REQUIRED' && w.stage === 'mining'));
  const brsr = brsrWasteTable(r.stages.flatMap((s) => s.streams));
  assert.equal(brsr.complete, false);
  assert.equal(brsr.streams_without_quantity, 2);
});

test('stage chain: measured data overrides benchmarks and flags a transfer mismatch', () => {
  const r = computeStageChain({
    industry: 'aluminium', final_product_t: 1000,
    stages: { refining: { product_t: 3000, chain_input_t: 7500, wastes: { red_mud: { tonnes: 3600, route: 'other_recovery' } } } },
  });
  const ref = r.stages.find((s) => s.id === 'refining');
  assert.equal(ref.product_basis, 'measured');
  assert.equal(ref.streams[0].basis, 'measured');
  assert.equal(ref.streams[0].splits[0].route, 'other_recovery');
  assert.ok(r.warnings.some((w) => w.code === 'STAGE_TRANSFER_MISMATCH'), 'smelting wants ~1978 t alumina, refining reports 3000 t');
  assert.equal(r.stages[0].chain_input.basis, 'estimated_benchmark');
  close(r.stages[1].chain_input.tonnes, 7500, 1e-9);
});

test('stage chain: mass balance catches outputs above inputs and unexplained gaps', () => {
  const over = computeStageChain({ industry: 'aluminium', stages: { refining: { product_t: 1000, chain_input_t: 2500, wastes: { red_mud: { tonnes: 2000 }, dregs_scale: { tonnes: 10 } } } } });
  assert.ok(over.warnings.some((w) => w.code === 'OUTPUTS_EXCEED_INPUTS'));
  const gap = computeStageChain({ industry: 'aluminium', stages: { refining: { product_t: 1000, chain_input_t: 2500, wastes: { red_mud: { tonnes: 200 }, dregs_scale: { tonnes: 10 } } } } });
  assert.ok(gap.warnings.some((w) => w.code === 'MASS_BALANCE_GAP'), 'red mud under-reported by a factor of six');
  const fine = computeStageChain({ industry: 'aluminium', stages: { refining: { product_t: 1000, chain_input_t: 2500, wastes: { red_mud: { tonnes: 1200 }, dregs_scale: { tonnes: 10 } } } } });
  assert.ok(!fine.warnings.some((w) => ['OUTPUTS_EXCEED_INPUTS', 'MASS_BALANCE_GAP'].includes(w.code)));
});

test('every industry profile is internally consistent', () => {
  for (const [id, p] of Object.entries(INDUSTRIES)) {
    assert.ok(p.stages.length >= 1, id);
    for (const s of p.stages) {
      assert.ok(s.product && s.chain_input?.label, `${id}/${s.id}`);
      for (const w of s.wastes) {
        assert.ok(WASTE_CLASSES[w.waste_class], `${id}/${s.id}/${w.id} class`);
        assert.ok(ROUTES[w.default_route], `${id}/${s.id}/${w.id} route`);
        if (w.per_t) assert.ok(w.per_t.min <= w.per_t.typ && w.per_t.typ <= w.per_t.max, `${id}/${w.id} range order`);
        const cls = WASTE_CLASSES[w.waste_class];
        if (cls.hazardous) assert.ok(ROUTES[w.default_route].hazardous_ok, `${id}/${w.id}: default route must be permissible for hazardous waste`);
      }
    }
    const r = computeStageChain({ industry: id, final_product_t: 100 });
    assert.equal(r.stages.length, p.stages.length);
  }
  for (const k of Object.values(FOD_K)) for (const v of Object.values(k)) assert.ok(v > 0);
});

test('benchmark stages with known profiles close their mass balance (no negative balancing item)', () => {
  for (const id of ['aluminium', 'steel_integrated', 'cement', 'foundry']) {
    const r = computeStageChain({ industry: id, final_product_t: 1000 });
    assert.ok(!r.warnings.some((w) => w.code === 'BENCHMARK_INCONSISTENT'), `${id}: ${JSON.stringify(r.warnings.filter((w) => w.code === 'BENCHMARK_INCONSISTENT'))}`);
  }
});

test('identification: expected streams per stage and text search', () => {
  const smelt = expectedStreams('aluminium', 'smelting');
  assert.equal(smelt.length, 1);
  assert.equal(smelt[0].hazardous, true);
  assert.equal(smelt[0].reg_item, 'Sch. I, 11.2 (cathode residues incl. pot lining)');
  assert.equal(smelt[0].ref_confidence, 'secondary');
  const hits = identifyByText('spent pot lining', 'aluminium');
  assert.equal(hits[0].stream_id, 'spent_pot_lining');
  assert.ok(identifyByText('etp sludge').some((h) => h.industry === 'textile'));
  assert.deepEqual(identifyByText('zz'), []);
});

test('validation: hazardous routing, prohibited routes, missing hazardous streams, assumptions', () => {
  const bad = runWaste({
    industry: 'aluminium', final_product_t: 1000,
    stages: { smelting: { wastes: { spent_pot_lining: { tonnes: 26, route: 'landfill_managed' } } }, casting: { wastes: { dross: { tonnes: 20, route: 'open_burning' } } } },
  }, CTX);
  const codes = bad.findings.map((f) => f.code);
  assert.ok(codes.includes('HAZ_ROUTE_NOT_PERMITTED'));
  assert.ok(codes.includes('PROHIBITED_ROUTE'));

  const missing = runWaste({ industry: 'aluminium', final_product_t: 1000 }, CTX);
  assert.ok(missing.findings.some((f) => f.code === 'EXPECTED_HAZARDOUS_MISSING' && f.stream === 'dross') === false, 'dross is benchmark-estimated, so it is not "missing"');

  const textileNoSludge = runWaste({ industry: 'textile', final_product_t: 100 }, CTX);
  assert.ok(textileNoSludge.findings.some((f) => f.code === 'EXPECTED_HAZARDOUS_MISSING' && f.stream === 'etp_sludge'));

  const noFac = runWaste({ industry: 'aluminium', final_product_t: 1000, stages: { smelting: { wastes: { spent_pot_lining: { tonnes: 26, route: 'secure_landfill' } } } } }, CTX);
  assert.ok(noFac.findings.some((f) => f.code === 'FACILITY_AUTH_MISSING'));

  const outlier = runWaste({ industry: 'aluminium', final_product_t: 1000, stages: { smelting: { product_t: 1030, wastes: { spent_pot_lining: { tonnes: 400, route: 'secure_landfill', facility: 'TSDF' } } } } }, CTX);
  assert.ok(outlier.findings.some((f) => f.code === 'OUTSIDE_BENCHMARK'));
  const lines = [{ stage: 'x', stream_id: 'y', label: 'Odd', extra: true, waste_class: 'plastic', tonnes: 1, basis: 'measured', splits: [{ route: 'landfill_managed', tonnes: 1 }] }];
  const f = validateDeclaredWaste('aluminium', lines);
  assert.ok(f.some((x) => x.code === 'STREAM_NOT_IN_PROFILE') && f.some((x) => x.code === 'PLASTIC_TO_LANDFILL'));
});

test('BRSR Principle 6 table reconciles generated = recovered + disposed', () => {
  const r = runWaste({
    industry: 'generic_msme',
    stages: { operations: { wastes: { paper: { tonnes: 2, route: 'recycling' }, plastic_packaging: { tonnes: 1, splits: [{ tonnes: 0.6, route: 'recycling' }, { tonnes: 0.4, route: 'incineration', facility: 'x' }] }, e_waste: { tonnes: 0.2, route: 'recycling', facility: 'R' } } } },
  }, CTX);
  const b = r.brsr;
  close(b.total.generated, 3.2, 1e-9);
  close(b.recovered_t + b.disposed_t, 3.2, 1e-9);
  assert.equal(b.unreconciled_t < 1e-9, true);
  close(b.rows.find((x) => x.key === 'plastic').generated, 1, 1e-9);
  close(b.rows.find((x) => x.key === 'e_waste').recycled, 0.2, 1e-9);
  close(b.rows.find((x) => x.key === 'other_non_hazardous').recycled, 2, 1e-9);
  assert.equal(b.complete, false, 'other streams in the profile still need quantities');
});

test('scope assignment of waste: on-site -> Scope 1, off-site -> Scope 3 category 5', () => {
  const r = runWaste({
    industry: 'generic_msme',
    stages: {},
    general_waste: [
      { id: 'a', label: 'On-site compost', waste_class: 'food_organic', tonnes: 10, route: 'composting', location: 'onsite' },
      { id: 'b', label: 'Municipal compost', waste_class: 'food_organic', tonnes: 10, route: 'composting', location: 'offsite' },
    ],
  }, CTX);
  const on = r.emissionLines.find((e) => e.stream_id === 'a');
  const off = r.emissionLines.find((e) => e.stream_id === 'b');
  assert.equal(on.scope, 1);
  assert.equal(off.scope, 3);
  assert.equal(off.scope3_category, 5);
  assert.equal(on.co2eKg, off.co2eKg);
});

test('cement: calcination default estimated and flagged; aluminium process emissions flagged as missing, not zero', () => {
  const c = runWaste({ industry: 'cement', final_product_t: 1000 }, CTX);
  const kiln = c.chain.stages.find((s) => s.id === 'kiln');
  assert.equal(kiln.process_emissions[0].basis, 'estimated_default');
  close(kiln.process_emissions[0].kg, kiln.product_t * 520, 1e-6);
  const a = runWaste({ industry: 'aluminium', final_product_t: 1000 }, CTX);
  assert.ok(a.not_assessed.some((x) => /Process emissions at stage "Smelting/.test(x)));
});

test('bad waste input never crashes the engine and never silently drops data', async () => {
  const { runInventory } = await import('../src/engine/calculate.js');
  const { sampleAluminiumUnit } = await import('../src/sample.js');
  const inv = sampleAluminiumUnit();
  inv.waste.stages.smelting.process_emissions.push({ gas: 'CO2' }); // blank row from the UI
  inv.waste.stages.refining = { wastes: { red_mudd: { tonnes: 10 } } }; // typo in stream id
  inv.waste.stages.smeltting = { product_t: 5 }; // typo in stage id
  inv.waste.stages.casting.wastes.dross.tonnes = -4;
  inv.waste.general_waste.push({ id: 'x', label: 'Broken', waste_class: 'plastic', tonnes: 'abc', route: 'recycling' });
  const out = runInventory(inv);
  const codes = out.result.waste.findings.map((f) => f.code);
  for (const c of ['PROCESS_EMISSION_INVALID', 'UNKNOWN_STREAM', 'UNKNOWN_STAGE', 'INVALID_QUANTITY']) assert.ok(codes.includes(c), c);
  assert.deepEqual(out.report_eligibility.allowed_statuses, ['draft'], 'these errors must block issuing a report');
});
