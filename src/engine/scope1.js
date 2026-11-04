import { convert, KG_PER_T } from './units.js';
import { findFuelFactor, periodCovers } from './factors.js';
import { toCo2e, gwpOf, REFRIGERANT_BLENDS } from './gwp.js';

/**
 * Fuel combustion. kg gas = fuel mass (t) x NCV (GJ/t) / 1000 x EF (kg gas / TJ).
 * Gas-specific results are converted to CO2e once, with the GWP set recorded in the manifest.
 */
export function calcFuel(a, { gwpSet, periodEnd }) {
  const f = findFuelFactor(a.fuel, a.use ?? 'stationary');
  const warnings = [];
  const ncv = a.ncv_override_gj_per_t ?? f.ncv_gj_per_t;
  if (a.ncv_override_gj_per_t) warnings.push({ code: 'NCV_OVERRIDE', message: `Using user-supplied NCV ${ncv} GJ/t instead of register default ${f.ncv_gj_per_t}.` });

  const massKg = fuelMassKg(a, f);
  const tj = ((massKg / KG_PER_T) * ncv) / 1000;
  const gases = {};
  let biogenicCo2 = 0;
  for (const [gas, ef] of Object.entries(f.ef_kg_per_tj)) {
    const kg = tj * ef;
    if (gas === 'CO2' && f.biogenic) biogenicCo2 = kg;
    else gases[gas] = kg;
  }
  if (!periodCovers(f, periodEnd)) warnings.push({ code: 'FACTOR_PERIOD', message: `${f.id} does not cover the reporting period.` });
  return {
    factor: f, gases, biogenicCo2Kg: biogenicCo2, co2eKg: toCo2e(gases, gwpSet),
    quantityBasis: `${round3(massKg / KG_PER_T)} t fuel, ${round3(tj * 1000)} GJ`, warnings,
  };
}

function fuelMassKg(a, f) {
  const unit = a.unit;
  if (['kg', 't', 'g', 'kt'].includes(unit)) return convert(a.quantity, unit, 'kg');
  if (['L', 'kL', 'm3'].includes(unit)) {
    const density = a.density_override_kg_per_l ?? f.density_kg_per_l;
    if (!density) throw new Error(`Fuel "${a.fuel}" cannot be entered by volume (no density). Enter mass.`);
    return convert(a.quantity, unit, 'L') * density;
  }
  throw new TypeError(`Unit "${unit}" is not valid for fuel "${a.fuel}"`);
}

/** Refrigerant leakage (kg topped-up = kg leaked, the usual MSME proxy) x GWP. */
export function calcRefrigerant(a, { gwpSet }) {
  const comp = REFRIGERANT_BLENDS[a.refrigerant];
  if (!comp) throw new Error(`Unsupported refrigerant "${a.refrigerant}". Supported: ${Object.keys(REFRIGERANT_BLENDS).join(', ')}`);
  const kg = convert(a.quantity, a.unit ?? 'kg', 'kg');
  const gases = {};
  for (const [gas, frac] of Object.entries(comp)) gases[gas] = kg * frac;
  return {
    factor: { id: `GWP-${gwpSet}-${a.refrigerant}`, status: 'provisional', source: { document: `IPCC ${gwpSet} GWP100`, table: 'Direct GWP of HFCs' } },
    gases, co2eKg: toCo2e(gases, gwpSet), quantityBasis: `${kg} kg ${a.refrigerant}`, warnings: [],
  };
}

/** Process emissions are measured/derived by the user per gas (kg) - the engine only converts to CO2e. */
export function calcProcessEmission(a, { gwpSet }) {
  const kg = convert(a.quantity, a.unit ?? 'kg', 'kg');
  gwpOf(a.gas, gwpSet);
  return {
    factor: { id: `PROC-USER-${a.gas}`, status: 'provisional', source: { document: 'User-supplied measurement/derivation', table: a.basis_note ?? 'not stated' } },
    gases: { [a.gas]: kg }, co2eKg: toCo2e({ [a.gas]: kg }, gwpSet), quantityBasis: `${kg} kg ${a.gas}`,
    warnings: a.basis_note ? [] : [{ code: 'PROCESS_BASIS', message: 'Process emission has no basis note (measurement, stoichiometry, IPCC tier).' }],
  };
}

const round3 = (x) => Math.round(x * 1000) / 1000;
