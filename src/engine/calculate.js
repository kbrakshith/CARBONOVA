import { createHash } from 'node:crypto';
import { calcFuel, calcRefrigerant, calcProcessEmission } from './scope1.js';
import { calcElectricity } from './scope2.js';
import { validateInventory, fyBounds } from './validate.js';
import { register } from './factors.js';
import { GWP_SETS, DEFAULT_GWP_SET } from './gwp.js';
import { runWaste } from '../waste/index.js';
import { round } from './units.js';

export const ENGINE_VERSION = '0.2.0';
export const FORMULA_VERSIONS = {
  fuel: 'ipcc2006-vol2-ncv-ef/1',
  electricity: 'ghgp-scope2-location-and-market/1',
  waste_landfill: 'ipcc2006-vol5-fod-spreadsheet/1',
  waste_bio_thermal: 'ipcc2006-vol5-tier1/1',
  stage_mass_balance: 'carbonova-stage-chain/1',
};

export const SCOPE3_CATEGORIES = {
  1: 'Purchased goods and services', 2: 'Capital goods', 3: 'Fuel- and energy-related activities (incl. T&D losses)',
  4: 'Upstream transportation and distribution', 5: 'Waste generated in operations', 6: 'Business travel', 7: 'Employee commuting',
  8: 'Upstream leased assets', 9: 'Downstream transportation and distribution', 10: 'Processing of sold products', 11: 'Use of sold products',
  12: 'End-of-life treatment of sold products', 13: 'Downstream leased assets', 14: 'Franchises', 15: 'Investments',
};

const hash = (o) => createHash('sha256').update(stable(o)).digest('hex');
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * Deterministic inventory run. Same input + same factor register => byte-identical results and result_hash.
 * No AI/LLM is used anywhere in this path.
 */
export function runInventory(inv) {
  const gwpSet = inv.gwp_set ?? DEFAULT_GWP_SET;
  if (!GWP_SETS[gwpSet]) throw new Error(`Unknown GWP set ${gwpSet}`);
  const validation = validateInventory(inv);
  const { reportingYear, start: periodStart, end: periodEnd } = fyBounds(inv.organisation.reporting_fy);

  const lines = [];
  const errorsByActivity = [];
  const factorsUsed = new Map();
  const note = (f) => f?.id && factorsUsed.set(f.id, f);

  const pending = (inv.activities ?? []).filter((x) => !x.voided && (x.review_status ?? 'confirmed') !== 'confirmed');
  for (const a of (inv.activities ?? []).filter((x) => !x.voided && (x.review_status ?? 'confirmed') === 'confirmed')) {
    if (validation.errors.some((e) => e.ref === a.id && ['ACTIVITY_TYPE', 'ACTIVITY_PERIOD', 'OUTSIDE_PERIOD', 'ACTIVITY_FACILITY', 'SCOPE3_CATEGORY', 'ACTIVITY_DUPLICATE_ID'].includes(e.code))) {
      errorsByActivity.push({ id: a.id, reason: 'failed validation; excluded from totals' });
      continue;
    }
    try {
      const ctx = { gwpSet, periodEnd };
      const base = { activity_id: a.id, facility_id: a.facility_id, type: a.type, period: a.period, data_quality: a.data_quality ?? 'measured', evidence_id: a.evidence?.id ?? null, fuel: a.fuel ?? null, label: a.label ?? null };
      if (a.type === 'electricity') {
        const r = calcElectricity(a, ctx);
        note(r.factor);
        lines.push({ ...base, scope: 2, method: 'location', quantity: r.importKwh, unit: 'kWh', factor_id: r.factor.id, gases: { CO2: r.locationKg }, co2eKg: r.locationKg, warnings: r.warnings,
          market_co2eKg: r.marketKg, site_consumption_kwh: r.siteConsumptionKwh });
        if (r.tdLossKg != null) lines.push({ ...base, scope: 3, scope3_category: 3, method: 'T&D loss on grid imports', quantity: r.importKwh, unit: 'kWh', factor_id: r.factor.id, gases: { CO2: r.tdLossKg }, co2eKg: r.tdLossKg, warnings: [] });
      } else if (a.type === 'fuel') {
        const r = calcFuel(a, ctx);
        note(r.factor);
        const third = a.ownership === 'third_party';
        lines.push({ ...base, scope: third ? 3 : 1, scope3_category: third ? a.scope3_category : null, method: `fuel combustion (${a.use ?? 'stationary'})`, quantity: a.quantity, unit: a.unit, quantity_basis: r.quantityBasis,
          factor_id: r.factor.id, gases: r.gases, biogenic_co2Kg: r.biogenicCo2Kg, co2eKg: r.co2eKg, warnings: r.warnings });
      } else if (a.type === 'refrigerant') {
        const r = calcRefrigerant(a, ctx);
        note(r.factor);
        lines.push({ ...base, scope: 1, method: 'refrigerant leakage x GWP', quantity: a.quantity, unit: a.unit ?? 'kg', factor_id: r.factor.id, gases: r.gases, co2eKg: r.co2eKg, warnings: r.warnings });
      } else if (a.type === 'process_emission') {
        const r = calcProcessEmission(a, ctx);
        note(r.factor);
        lines.push({ ...base, scope: 1, method: 'process emission (user-supplied)', quantity: a.quantity, unit: a.unit ?? 'kg', factor_id: r.factor.id, gases: r.gases, co2eKg: r.co2eKg, warnings: r.warnings });
      }
    } catch (e) {
      errorsByActivity.push({ id: a.id, reason: e.message });
    }
  }

  // Waste (stage-wise by industry) and process emissions derived from the stage chain
  let waste = null;
  if (inv.waste) {
    waste = runWaste({ industry: inv.organisation.industry, ...inv.waste }, { gwpSet, reportingYear });
    for (const e of waste.emissionLines) {
      lines.push({
        activity_id: `waste:${e.stage}/${e.stream_id}/${e.route}`, type: 'waste', facility_id: null, scope: e.scope, scope3_category: e.scope3_category,
        period: { start: periodStart, end: periodEnd }, data_quality: e.basis === 'measured' ? 'measured' : 'estimated', evidence_id: null,
        method: e.method, quantity: e.tonnes, unit: 't wet', factor_id: 'IPCC2006-VOL5-DEFAULTS', gases: e.gases, co2eKg: e.co2eKg, warnings: [],
        waste_detail: { stage: e.stage, stream: e.label, waste_class: e.waste_class, route: e.route, location: e.location, assessed: e.assessed, fod: e.detail },
      });
    }
    for (const p of waste.process_emissions) {
      const r = calcProcessEmission({ gas: p.gas, quantity: p.kg, unit: 'kg', basis_note: p.basis_note }, { gwpSet });
      lines.push({
        activity_id: `process:${p.stage}/${p.gas}`, type: 'process_emission', facility_id: null, scope: 1, method: `process emission - ${p.basis}`, period: { start: periodStart, end: periodEnd },
        data_quality: p.basis === 'measured' ? 'measured' : 'estimated', evidence_id: null, quantity: p.kg, unit: 'kg', factor_id: r.factor.id, gases: r.gases, co2eKg: r.co2eKg, warnings: r.warnings,
      });
    }
    factorsUsed.set('IPCC2006-VOL5-DEFAULTS', { id: 'IPCC2006-VOL5-DEFAULTS', status: 'provisional', source: { document: 'IPCC 2006 Guidelines Vol.5 Waste (Tables 2.4, 3.1, 3.3, 4.1, 5.x defaults)', table: 'see src/waste/taxonomy.js' } });
  }

  // Totals. Scope 3 only counts categories actually calculated; the rest are listed, never zero.
  const sum = (arr, f) => arr.reduce((s, l) => s + f(l), 0);
  const s1 = lines.filter((l) => l.scope === 1);
  const s2 = lines.filter((l) => l.scope === 2);
  const s3 = lines.filter((l) => l.scope === 3);
  const totals = {
    scope1_kg: sum(s1, (l) => l.co2eKg),
    scope2_location_kg: sum(s2, (l) => l.co2eKg),
    scope2_market_kg: sum(s2, (l) => l.market_co2eKg ?? l.co2eKg),
    scope3_assessed_kg: sum(s3, (l) => l.co2eKg),
    biogenic_co2_kg: sum(lines, (l) => l.biogenic_co2Kg ?? 0),
  };
  totals.scope1_2_location_kg = totals.scope1_kg + totals.scope2_location_kg;
  totals.scope1_2_3_assessed_kg = totals.scope1_2_location_kg + totals.scope3_assessed_kg;
  const tonnes = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k.replace(/_kg$/, '_t'), round(v / 1000, 3)]));

  const byGas = {};
  for (const l of lines) for (const [g, kg] of Object.entries(l.gases ?? {})) byGas[g] = (byGas[g] ?? 0) + kg;

  const scope3Screening = Object.entries(SCOPE3_CATEGORIES).map(([n, name]) => {
    const cat = Number(n);
    const got = s3.filter((l) => l.scope3_category === cat);
    const declared = inv.scope3_screening?.[cat];
    if (got.length) return { category: cat, name, status: 'calculated', co2e_t: round(sum(got, (l) => l.co2eKg) / 1000, 3), lines: got.length };
    if (declared?.status === 'excluded') return { category: cat, name, status: 'excluded', reason: declared.reason };
    return { category: cat, name, status: 'not_assessed', reason: 'No data or calculation method in this release. NOT zero.' };
  });

  const exclusions = [
    'Grid electricity factor is CO2-only: CH4/N2O from grid generation are not included.',
    ...(waste?.not_assessed ?? []),
    ...scope3Screening.filter((s) => s.status === 'not_assessed').map((s) => `Scope 3 category ${s.category} (${s.name}): not assessed`),
    ...(inv.organisation.exclusions ?? []).map((x) => `Declared: ${x}`),
    ...errorsByActivity.map((x) => `Activity ${x.id}: ${x.reason}`),
    ...pending.map((x) => `Activity ${x.id}: awaiting review, not included in totals`),
  ];

  const measured = sum(lines.filter((l) => l.data_quality === 'measured'), (l) => l.co2eKg);
  const allCo2e = sum(lines, (l) => l.co2eKg);
  const quality = { measured_share: allCo2e ? round(measured / allCo2e, 3) : null, estimated_share: allCo2e ? round(1 - measured / allCo2e, 3) : null };

  const intensity = inv.organisation.revenue_inr
    ? { basis: 'Scope 1 + Scope 2 (location-based) per INR million turnover', t_co2e_per_inr_million: round(totals.scope1_2_location_kg / 1000 / (inv.organisation.revenue_inr / 1e6), 4), revenue_inr: inv.organisation.revenue_inr }
    : null;

  const factors = [...factorsUsed.values()].map((f) => ({ id: f.id, status: f.status, version: f.source?.published ?? null, document: f.source?.document, table: f.source?.table, valid_from: f.valid_from ?? null, valid_to: f.valid_to ?? null }));
  const provisional = factors.filter((f) => f.status !== 'validated');
  const flagged = lines.flatMap((l) => (l.warnings ?? []).map((w) => ({ ...w, ref: l.activity_id })));

  const result = {
    organisation: inv.organisation.legal_name, reporting_fy: inv.organisation.reporting_fy, gwp_set: gwpSet,
    totals_kg: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v])), totals_t: tonnes, by_gas_kg: byGas, intensity, quality, scope3_screening: scope3Screening,
    lines, waste: waste && { chain: waste.chain, brsr: waste.brsr, findings: waste.findings, totals: waste.totals, lines: waste.lines },
    exclusions, validation, warnings: flagged,
  };

  const manifest = {
    engine_version: ENGINE_VERSION, formula_versions: FORMULA_VERSIONS,
    gwp: { set: gwpSet, label: GWP_SETS[gwpSet].label, values: GWP_SETS[gwpSet] },
    factor_register: { version: register().version, hash: register().hash }, factors,
    input_hash: hash({ organisation: inv.organisation, activities: inv.activities, waste: inv.waste, gwp_set: gwpSet, scope3_screening: inv.scope3_screening }),
    result_hash: hash(result),
  };

  const blocking = [
    ...validation.errors,
    ...(waste?.findings ?? []).filter((f) => f.severity === 'error').map((f) => ({ code: f.code, message: f.message })),
    ...flagged.filter((w) => w.severity === 'error').map((w) => ({ code: w.code, message: w.message, ref: w.ref })),
  ];
  const allowed = ['draft'];
  if (!blocking.length) allowed.push('self_declared');
  if (!blocking.length && !provisional.length) allowed.push('internally_reviewed');
  // 'externally_assured' can only be recorded by an independent assurer outside this engine.

  return { result, manifest, report_eligibility: { blocking, provisional_factors: provisional.map((f) => f.id), allowed_statuses: allowed } };
}
