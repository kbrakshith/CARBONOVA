import { convert } from './units.js';
import { findGridFactor, periodCovers } from './factors.js';

/**
 * Electricity. Only GRID IMPORTS carry the grid factor. On-site solar is zero-emission
 * at the point of use and is kept as separate evidence so generation, self-consumption
 * and exports are reconciled, never added to or subtracted from imports blindly.
 *
 *   location-based = grid_import x grid EF
 *   market-based   = (grid_import - contractual_re_kwh) x residual EF
 * India publishes no residual-mix factor, so market-based falls back to the grid
 * average and says so.
 */
export function calcElectricity(a, { periodEnd }) {
  const warnings = [];
  const imp = convert(a.grid_import_kwh ?? 0, 'kWh', 'kWh');
  const gen = a.solar_generated_kwh ?? 0;
  const self = a.solar_self_consumed_kwh ?? 0;
  const exp = a.solar_exported_kwh ?? 0;
  if (self + exp > gen * 1.01 + 1e-9) {
    warnings.push({ code: 'SOLAR_RECONCILE', severity: 'error', message: `Self-consumed (${self}) + exported (${exp}) kWh exceeds generation (${gen}) kWh.` });
  }
  const re = a.contractual_re_kwh ?? 0;
  if (re > imp) warnings.push({ code: 'RE_EXCEEDS_IMPORT', severity: 'error', message: 'Contractual renewable kWh exceeds grid imports.' });

  const f = findGridFactor(periodEnd);
  if (!periodCovers(f, periodEnd)) {
    warnings.push({ code: 'FACTOR_PERIOD', severity: 'warning', message: `${f.id} covers ${f.valid_from}..${f.valid_to ?? 'open'} but the period ends ${periodEnd}. Load the factor for this financial year.` });
  }
  const ef = f.values.CO2; // kg CO2 / kWh
  const locationKg = imp * ef;
  const marketKg = Math.max(imp - re, 0) * ef;

  let tdLossKg = null;
  if (typeof a.td_loss_pct === 'number') tdLossKg = imp * (a.td_loss_pct / 100) * ef; // Scope 3 cat 3 (upstream energy)

  return {
    factor: f, locationKg, marketKg, tdLossKg, importKwh: imp,
    siteConsumptionKwh: imp + self, // information only
    warnings,
  };
}
