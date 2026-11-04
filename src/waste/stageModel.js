import { getIndustry } from './industries.js';
import { WASTE_CLASSES, ROUTES } from './taxonomy.js';
import { GWP_SETS } from '../engine/gwp.js';

const GAP_TOLERANCE = 0.10; // allowed difference between measured and benchmark unexplained-loss fraction
const TRANSFER_TOLERANCE = 0.05; // allowed mismatch between one stage's product and the next stage's input

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const sumKnown = (arr) => arr.reduce((s, x) => s + (num(x) ? x : 0), 0);

/**
 * Walk an industry's stages from the final product back to the raw material.
 *
 * Inputs (`data`):
 *   industry, final_product_t, stages: { [stageId]: { product_t?, chain_input_t?, wastes?: { [streamId]: { tonnes | splits } },
 *            extra_wastes?: [...], process_emissions?: [...] } }
 *
 * Anything the unit measured wins over benchmarks. Anything with no measurement and no benchmark is reported as
 * "measurement_required" - never zero.
 */
export function computeStageChain(data) {
  const profile = getIndustry(data.industry);
  const stagesData = data.stages ?? {};
  const warnings = [];
  const n = profile.stages.length;
  for (const key of Object.keys(stagesData)) {
    const st = profile.stages.find((x) => x.id === key);
    if (!st) { warnings.push({ code: 'UNKNOWN_STAGE', severity: 'error', stage: key, message: `Stage "${key}" is not part of the ${profile.label} profile: its data was NOT used.` }); continue; }
    for (const sid of Object.keys(stagesData[key]?.wastes ?? {})) {
      if (!st.wastes.some((w) => w.id === sid)) warnings.push({ code: 'UNKNOWN_STREAM', severity: 'error', stage: key, message: `Waste stream "${sid}" is not defined for stage "${st.name}": its data was NOT used. Add it as an extra stream instead.` });
    }
  }
  const results = new Array(n);

  let carry = num(data.final_product_t) ? data.final_product_t : null; // product tonnes expected out of stage i
  for (let i = n - 1; i >= 0; i--) {
    const st = profile.stages[i];
    const m = stagesData[st.id] ?? {};
    const warn = (code, severity, message) => warnings.push({ code, severity, stage: st.id, message });

    let productT = num(m.product_t) ? m.product_t : carry;
    const productBasis = num(m.product_t) ? 'measured' : productT == null ? 'unknown' : 'derived_from_next_stage';
    if (num(m.product_t) && carry != null && Math.abs(m.product_t - carry) / Math.max(carry, 1e-9) > TRANSFER_TOLERANCE) {
      warn('STAGE_TRANSFER_MISMATCH', 'warning', `Measured product ${m.product_t} t differs from what the next stage consumes (${round(carry)} t) by more than ${TRANSFER_TOLERANCE * 100}%.`);
    }

    // chain input (what the previous stage must supply)
    const per = st.chain_input.per_t;
    let chainInputT = null;
    let chainBasis = 'unknown';
    if (num(m.chain_input_t)) { chainInputT = m.chain_input_t; chainBasis = 'measured'; }
    else if (productT != null && per) { chainInputT = productT * per.typ; chainBasis = 'estimated_benchmark'; }
    else if (productT != null && !per) { warn('NO_YIELD_BENCHMARK', 'info', `No yield benchmark for ${st.name}: enter its input tonnage to carry the chain upstream.`); }

    const inputRange = productT != null && per && chainBasis === 'estimated_benchmark' ? { min: productT * per.min, max: productT * per.max } : null;

    // wastes
    const streamResults = [];
    for (const w of st.wastes) {
      const given = m.wastes?.[w.id];
      const base = {
        stage: st.id, stream_id: w.id, label: w.label, waste_class: w.waste_class,
        brsr: w.brsr ?? WASTE_CLASSES[w.waste_class].brsr, hazardous: WASTE_CLASSES[w.waste_class].hazardous,
        hvle: !!w.hvle, regs: w.regs ?? [], reg_item: w.reg_item ?? null, ref_confidence: w.ref_confidence ?? null, note: w.note ?? null,
      };
      const badQty = [given?.tonnes, ...(given?.splits ?? []).map((x) => x.tonnes)].some((x) => x !== undefined && (!num(x) || x < 0));
      if (badQty) {
        warn('INVALID_QUANTITY', 'error', `"${w.label}": tonnage must be a number >= 0.`);
        streamResults.push({ ...base, tonnes: null, basis: 'measurement_required', range: null, splits: [] });
      } else if (given && (num(given.tonnes) || given.splits?.length)) {
        const splits = given.splits?.length ? given.splits : [{ tonnes: given.tonnes, route: given.route, location: given.location }];
        const total = sumKnown(splits.map((s) => s.tonnes));
        streamResults.push({ ...base, tonnes: total, basis: 'measured', range: null, splits: splits.map((s) => normaliseSplit(s, w, given)) });
      } else if (w.per_t && productT != null) {
        const t = productT * w.per_t.typ;
        streamResults.push({ ...base, tonnes: t, basis: 'estimated_benchmark', range: { min: productT * w.per_t.min, max: productT * w.per_t.max },
          splits: [normaliseSplit({ tonnes: t }, w, {})] });
      } else {
        streamResults.push({ ...base, tonnes: null, basis: 'measurement_required', range: null, splits: [] });
      }
    }
    for (const x of m.extra_wastes ?? []) {
      if (!WASTE_CLASSES[x.waste_class]) { warn('EXTRA_WASTE_CLASS', 'error', `Extra stream "${x.label}": unknown waste_class "${x.waste_class}".`); continue; }
      streamResults.push({
        stage: st.id, stream_id: x.id ?? `extra_${streamResults.length}`, label: x.label, waste_class: x.waste_class,
        brsr: x.brsr ?? WASTE_CLASSES[x.waste_class].brsr, hazardous: WASTE_CLASSES[x.waste_class].hazardous, hvle: false, regs: [], reg_item: null,
        ref_confidence: null, note: 'User-added stream (not in the industry profile).', tonnes: x.tonnes, basis: 'measured', range: null, extra: true,
        splits: [normaliseSplit({ tonnes: x.tonnes, route: x.route, location: x.location }, { default_route: x.route ?? 'other_disposal' }, {})],
      });
    }

    // mass balance
    const known = streamResults.filter((s) => num(s.tonnes));
    const missing = streamResults.filter((s) => !num(s.tonnes));
    const wasteT = sumKnown(known.map((s) => s.tonnes));
    const typIn = (st.chain_input.per_t?.typ ?? NaN) + sumKnown((st.other_inputs ?? []).map((x) => x.per_t.typ)) + sumKnown((st.atmospheric_inputs ?? []).map((x) => x.per_t.typ));
    const typOut = 1 + sumKnown(st.wastes.map((x) => x.per_t?.typ));
    // Typical unexplained fraction (moisture, off-gas) from the benchmarked streams; streams with no benchmark count as
    // zero here, which makes the check one-sided: it can only reveal MISSING waste, never excuse it.
    const expectedLossFraction = Number.isFinite(typIn) ? (typIn - typOut) / typIn : null;

    const mb = { status: 'incomplete', inputs_t: null, outputs_t: null, unexplained_t: null, unexplained_fraction: null, expected_fraction: expectedLossFraction == null ? null : round(expectedLossFraction, 3) };
    if (productT != null && chainInputT != null) {
      const otherIn = chainBasis === 'measured'
        ? sumKnown((st.other_inputs ?? []).map((x) => (num(m.other_inputs_t?.[x.id]) ? m.other_inputs_t[x.id] : 0)))
        : sumKnown([...(st.other_inputs ?? []), ...(st.atmospheric_inputs ?? [])].map((x) => productT * x.per_t.typ));
      const inputs = chainInputT + otherIn;
      const outputs = productT + wasteT;
      mb.inputs_t = round(inputs); mb.outputs_t = round(outputs);
      mb.unexplained_t = round(inputs - outputs);
      mb.unexplained_fraction = round((inputs - outputs) / inputs, 3);
      mb.status = missing.length ? 'incomplete_streams_unmeasured' : 'closed';
      if (chainBasis === 'measured' && !missing.length) {
        if (mb.unexplained_fraction < -0.02) {
          warn('OUTPUTS_EXCEED_INPUTS', 'error', `Product + waste (${round(outputs)} t) exceeds input (${round(inputs)} t): a figure is wrong or a stream is double counted.`);
        } else if (expectedLossFraction != null && mb.unexplained_fraction - expectedLossFraction > GAP_TOLERANCE) {
          warn('MASS_BALANCE_GAP', 'warning', `Unexplained mass ${round(mb.unexplained_fraction * 100, 1)}% of input vs ~${round(expectedLossFraction * 100, 1)}% typical (moisture, gases): a waste stream may be missing or mis-weighed.`);
        }
      }
      if (chainBasis !== 'measured' && mb.unexplained_fraction < -0.02) warn('BENCHMARK_INCONSISTENT', 'warning', 'Benchmark yields and waste ratios do not balance; treat estimate with caution.');
    }
    for (const s of missing) warn('MEASUREMENT_REQUIRED', 'info', `"${s.label}" has no benchmark: enter the measured tonnage (shown as not assessed, not zero).`);

    // process emissions
    const process = [];
    for (const p of m.process_emissions ?? []) {
      if (!num(p.kg) || p.kg < 0 || !GWP_SETS.AR6[p.gas]) { warn('PROCESS_EMISSION_INVALID', 'error', `Process emission row (${p.gas ?? 'no gas'}, ${p.kg ?? 'no amount'}) is incomplete: it was NOT used.`); continue; }
      process.push({ gas: p.gas, kg: p.kg, basis: 'measured', basis_note: p.basis_note ?? null });
    }
    if (!process.length && st.process_default && productT != null) {
      process.push({ gas: st.process_default.gas, kg: productT * st.process_default.kg_per_t_product, basis: 'estimated_default', basis_note: st.process_default.basis });
      warn('PROCESS_DEFAULT', 'info', `Process ${st.process_default.gas} estimated from a default factor (${st.process_default.basis}). Replace with plant data.`);
    }
    const processMissing = !!st.process_emissions?.expected && !process.length;
    if (processMissing) warn('PROCESS_EMISSION_MISSING', 'warning', `${st.name}: process emissions (${st.process_emissions.gases.join(', ')}) expected but not entered - listed as an exclusion, not zero. ${st.process_emissions.note}`);

    results[i] = {
      id: st.id, name: st.name, product: st.product, product_t: productT == null ? null : round(productT), product_basis: productBasis,
      chain_input: { label: st.chain_input.label, tonnes: chainInputT == null ? null : round(chainInputT), basis: chainBasis, range: inputRange && { min: round(inputRange.min), max: round(inputRange.max) } },
      streams: streamResults, waste_t: round(wasteT), mass_balance: mb, process_emissions: process, process_emissions_missing: processMissing,
    };
    carry = chainInputT; // what the previous stage must deliver
  }

  const finalT = num(data.final_product_t) ? data.final_product_t : results[n - 1].product_t;
  const totalWaste = sumKnown(results.map((r) => r.waste_t));
  const unmeasuredStreams = results.flatMap((r) => r.streams.filter((s) => s.basis === 'measurement_required'));
  const summary = {
    final_product_t: finalT,
    total_waste_t_known: round(totalWaste),
    waste_per_t_final_product: finalT ? round(totalWaste / finalT, 3) : null,
    hazardous_t: round(sumKnown(results.flatMap((r) => r.streams).filter((s) => s.hazardous).map((s) => s.tonnes))),
    streams_requiring_measurement: unmeasuredStreams.length,
    complete: unmeasuredStreams.length === 0,
  };
  return { industry: data.industry, industry_label: profile.label, stages: results, summary, warnings };
}

function normaliseSplit(s, stream, given) {
  const route = s.route ?? given.route ?? stream.default_route;
  if (!ROUTES[route]) throw new Error(`Unknown treatment route "${route}" for stream`);
  return {
    tonnes: s.tonnes, route, route_assumed: !(s.route ?? given.route),
    location: s.location ?? given.location ?? 'offsite', // onsite = within the organisational boundary
    facility: s.facility ?? given.facility ?? null,
  };
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
