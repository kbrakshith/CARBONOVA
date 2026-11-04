// Global warming potentials (100-year horizon). The set used is recorded in the
// calculation manifest, so a report can always be reproduced with its original basis.
// AR6 CH4 = 27.9 is the generic value used by the GHG Protocol / proposal; AR6 also
// publishes 27.0 (non-fossil) and 29.8 (fossil). Gas-specific split is intentionally
// not applied here - disclose in the methodology note if a verifier asks for it.

export const GWP_SETS = {
  AR6: { label: 'IPCC AR6 (2021), GWP100', CO2: 1, CH4: 27.9, N2O: 273, CF4: 7380, C2F6: 12400, SF6: 25200, 'HFC-32': 771, 'HFC-125': 3740, 'HFC-134a': 1530 },
  AR5: { label: 'IPCC AR5 (2014), GWP100', CO2: 1, CH4: 28, N2O: 265, CF4: 6630, C2F6: 11100, SF6: 23500, 'HFC-32': 677, 'HFC-125': 3170, 'HFC-134a': 1300 },
  AR4: { label: 'IPCC AR4 (2007), GWP100', CO2: 1, CH4: 25, N2O: 298, CF4: 7390, C2F6: 12200, SF6: 22800, 'HFC-32': 675, 'HFC-125': 3500, 'HFC-134a': 1430 },
};

export const DEFAULT_GWP_SET = 'AR6';

// Common blends, as mass fractions of single gases.
export const REFRIGERANT_BLENDS = {
  'R-410A': { 'HFC-32': 0.5, 'HFC-125': 0.5 },
  'R-32': { 'HFC-32': 1 },
  'R-134a': { 'HFC-134a': 1 },
};

export function gwpOf(gas, setId = DEFAULT_GWP_SET) {
  const set = GWP_SETS[setId];
  if (!set) throw new Error(`Unknown GWP set "${setId}"`);
  const v = set[gas];
  if (typeof v !== 'number') throw new Error(`No ${setId} GWP for gas "${gas}"`);
  return v;
}

/** Convert a { gas: kg } map to kg CO2e. */
export function toCo2e(gases, setId = DEFAULT_GWP_SET) {
  let total = 0;
  for (const [gas, kg] of Object.entries(gases)) total += kg * gwpOf(gas, setId);
  return total;
}
