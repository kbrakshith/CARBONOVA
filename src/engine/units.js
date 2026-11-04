// Explicit unit conversion. Every conversion goes through a named dimension so
// that an incompatible request (e.g. litres -> kWh) fails loudly instead of
// silently producing a number.

const DIMENSIONS = {
  mass: { kg: 1, g: 0.001, t: 1000, kt: 1e6 },
  energy: { kWh: 1, MWh: 1000, GWh: 1e6, MJ: 1 / 3.6, GJ: 1000 / 3.6 },
  volume: { L: 1, kL: 1000, m3: 1000 },
  distance: { km: 1 },
};

export function dimensionOf(unit) {
  for (const [dim, units] of Object.entries(DIMENSIONS)) {
    if (unit in units) return dim;
  }
  return null;
}

export function convert(value, from, to) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`Quantity must be a finite number, got ${value}`);
  }
  if (value < 0) throw new RangeError(`Quantity must not be negative, got ${value}`);
  const dim = dimensionOf(from);
  if (!dim) throw new TypeError(`Unknown unit "${from}"`);
  if (dimensionOf(to) !== dim) {
    throw new TypeError(`Cannot convert ${from} (${dim}) to ${to} (${dimensionOf(to) ?? 'unknown'})`);
  }
  return (value * DIMENSIONS[dim][from]) / DIMENSIONS[dim][to];
}

export const KG_PER_T = 1000;
export const CO2_PER_C = 44 / 12;
export const CH4_PER_C = 16 / 12;

export function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}
