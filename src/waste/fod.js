import { CH4_PER_C } from '../engine/units.js';
import { FOD_DEFAULTS } from './taxonomy.js';

/**
 * IPCC 2006 Vol.5 first-order-decay model (Tier 1 spreadsheet form), genuinely time-dependent.
 *
 * Per deposit year T (W in tonnes of WET waste):
 *   DDOCmd_T = W_T x DOC x DOCf x MCF
 *   DDOCma_T = DDOCmd_T x e^(-k(13-M)/12) + DDOCma_(T-1) x e^(-k)
 *   Decomposed_T = DDOCmd_T x (1 - e^(-k(13-M)/12)) + DDOCma_(T-1) x (1 - e^(-k))
 *   CH4 generated_T = Decomposed_T x F x 16/12
 *   CH4 emitted_T = CH4 generated_T x (1 - R) x (1 - OX)
 * M = month in which decay starts (default 7 = six-month delay).
 *
 * `deposits` is [{ year, tonnes }]; the series runs from the first deposit for `horizonYears`
 * after the last, so a single reporting-year deposit returns its full multi-year emission curve.
 */
export function fodSeries({ deposits, doc, k, mcf, docf = FOD_DEFAULTS.docf, f = FOD_DEFAULTS.f, ox = FOD_DEFAULTS.ox, recoveredFraction = 0, delayMonthsM = FOD_DEFAULTS.delayMonthsM, horizonYears = FOD_DEFAULTS.horizonYears }) {
  if (!(k > 0)) throw new RangeError('k must be > 0');
  if (!(mcf >= 0 && mcf <= 1)) throw new RangeError('MCF must be within 0..1');
  if (!deposits?.length) return { series: [], totalCh4T: 0, firstYearCh4T: 0, ddocmDepositedT: 0 };

  const byYear = new Map();
  for (const d of deposits) {
    if (!(d.tonnes >= 0)) throw new RangeError('Deposit tonnes must be >= 0');
    byYear.set(d.year, (byYear.get(d.year) ?? 0) + d.tonnes);
  }
  const first = Math.min(...byYear.keys());
  const last = Math.max(...byYear.keys());
  const partial = Math.exp((-k * (13 - delayMonthsM)) / 12);
  const annual = Math.exp(-k);

  let accumulated = 0; // DDOCma at end of previous year
  let ddocmDeposited = 0;
  let totalCh4 = 0;
  const series = [];
  for (let year = first; year <= last + horizonYears; year++) {
    const ddocmd = (byYear.get(year) ?? 0) * doc * docf * mcf;
    ddocmDeposited += ddocmd;
    const decomposed = ddocmd * (1 - partial) + accumulated * (1 - annual);
    accumulated = ddocmd * partial + accumulated * annual;
    const generated = decomposed * f * CH4_PER_C;
    const emitted = generated * (1 - recoveredFraction) * (1 - ox);
    totalCh4 += emitted;
    series.push({ year, ch4T: emitted });
  }
  return { series, totalCh4T: totalCh4, firstYearCh4T: series[0].ch4T, ddocmDepositedT: ddocmDeposited };
}

/** Closed-form total of the same model as horizon -> infinity: used by tests as an independent reference. */
export function fodLifetimeCh4Reference({ tonnes, doc, mcf, docf = FOD_DEFAULTS.docf, f = FOD_DEFAULTS.f, ox = FOD_DEFAULTS.ox, recoveredFraction = 0 }) {
  return tonnes * doc * docf * mcf * f * CH4_PER_C * (1 - recoveredFraction) * (1 - ox);
}
