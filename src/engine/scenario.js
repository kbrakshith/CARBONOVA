import { runInventory } from './calculate.js';
import { fyBounds } from './validate.js';
import { ROUTES } from '../waste/taxonomy.js';

/**
 * What-if scenarios. A scenario edits a COPY of the inventory and re-runs the same deterministic engine,
 * so every delta comes from the real calculation, never from a separate approximation.
 *
 * levers:
 *   solar_kwp_added        rooftop solar capacity added (kWp). Displaces grid imports, capped at imports.
 *   solar_yield_kwh_per_kwp_yr   assumption (default 1400)
 *   diesel_genset_cut      0..1 share of stationary diesel avoided
 *   contractual_re_share   0..1 share of grid imports covered by documented renewable contracts (market-based only)
 *   grid_cut_share         0..1 share of grid imports avoided by efficiency (e.g. LED lighting)
 *   mobile_fuel_cut        0..1 share of vehicle fuel avoided (route optimisation, driver practice), owned and hired
 *   route_shifts           [{ stream_id, stage?, to_route, share(0..1), location?, facility? }]
 *                          moves a share of a waste stream's tonnes to another treatment route (optional from_routes limits the source routes)
 */
export const DEFAULT_SOLAR_YIELD = 1400;

export function applyScenario(inv, levers = {}) {
  const copy = structuredClone(inv);
  const { start, end } = fyBounds(copy.organisation.reporting_fy);
  const notes = [];

  // days covered by recorded electricity data, to scale annual solar generation to the recorded period
  const elec = copy.activities.filter((a) => a.type === 'electricity' && !a.voided);
  const recordedDays = elec.reduce((s, a) => s + (Date.parse(a.period.end) - Date.parse(a.period.start)) / 86400000 + 1, 0);
  const imports = elec.reduce((s, a) => s + (a.grid_import_kwh ?? 0), 0);

  if (levers.solar_kwp_added > 0 && imports > 0) {
    const yieldKwh = levers.solar_yield_kwh_per_kwp_yr ?? DEFAULT_SOLAR_YIELD;
    const gen = levers.solar_kwp_added * yieldKwh * Math.min(recordedDays, 365) / 365;
    const displaced = Math.min(gen, imports);
    if (gen > imports) notes.push(`Solar output (${Math.round(gen)} kWh) exceeds recorded imports; capped at ${Math.round(imports)} kWh with no export credit.`);
    for (const a of elec) {
      const share = (a.grid_import_kwh ?? 0) / imports;
      const cut = displaced * share;
      a.grid_import_kwh = Math.max((a.grid_import_kwh ?? 0) - cut, 0);
      a.solar_generated_kwh = (a.solar_generated_kwh ?? 0) + cut;
      a.solar_self_consumed_kwh = (a.solar_self_consumed_kwh ?? 0) + cut;
    }
  }
  if (levers.grid_cut_share > 0) {
    for (const a of elec) a.grid_import_kwh = (a.grid_import_kwh ?? 0) * (1 - Math.min(levers.grid_cut_share, 1));
  }
  if (levers.mobile_fuel_cut > 0) {
    for (const a of copy.activities) if (a.type === 'fuel' && a.use === 'mobile' && !a.voided) a.quantity *= 1 - Math.min(levers.mobile_fuel_cut, 1);
  }
  if (levers.contractual_re_share > 0) {
    for (const a of elec) a.contractual_re_kwh = (a.contractual_re_kwh ?? 0) + (a.grid_import_kwh ?? 0) * Math.min(levers.contractual_re_share, 1);
  }
  if (levers.diesel_genset_cut > 0) {
    for (const a of copy.activities) if (a.type === 'fuel' && a.fuel === 'diesel' && a.use === 'stationary' && a.ownership === 'owned') a.quantity *= 1 - Math.min(levers.diesel_genset_cut, 1);
  }

  if (levers.route_shifts?.length) {
    // Resolve tonnes and current routes from a baseline run, then rewrite the waste input as explicit splits.
    const base = runInventory(inv).result.waste;
    for (const shift of levers.route_shifts) {
      if (!ROUTES[shift.to_route]) throw new Error(`Unknown route ${shift.to_route}`);
      const line = base.lines.find((l) => l.stream_id === shift.stream_id && (!shift.stage || l.stage === shift.stage));
      if (!line || typeof line.tonnes !== 'number') { notes.push(`Stream ${shift.stream_id}: no quantity to shift.`); continue; }
      const share = Math.min(Math.max(shift.share ?? 1, 0), 1);
      const eligible = (sp) => !shift.from_routes || shift.from_routes.includes(sp.route);
      let moved = 0;
      const splits = [];
      for (const sp of line.splits) {
        const take = eligible(sp) ? sp.tonnes * share : 0;
        moved += take;
        if (sp.tonnes - take > 0) splits.push({ tonnes: sp.tonnes - take, route: sp.route, location: sp.location, facility: sp.facility });
      }
      splits.push({ tonnes: moved, route: shift.to_route, location: shift.location ?? 'offsite', facility: shift.facility ?? 'Scenario facility (to be contracted)' });
      if (line.stage === 'general') {
        const g = copy.waste.general_waste.find((x) => (x.id ?? '') === line.stream_id) ?? copy.waste.general_waste[Number(line.stream_id.split('_')[1])];
        if (g) g.splits = splits;
      } else {
        copy.waste.stages ??= {};
        const st = (copy.waste.stages[line.stage] ??= {});
        st.wastes ??= {};
        st.wastes[line.stream_id] = { splits };
      }
    }
  }
  return { inventory: copy, notes, period: { start, end } };
}

export function runScenario(inv, levers) {
  const base = runInventory(inv);
  const { inventory, notes } = applyScenario(inv, levers);
  const scen = runInventory(inventory);
  const d = (a, b) => (a - b) / 1000; // kg -> t, positive = reduction, from UNROUNDED totals
  const tb = base.result.totals_kg;
  const ts = scen.result.totals_kg;
  const rb = base.result.waste?.brsr;
  const rs = scen.result.waste?.brsr;
  return {
    notes,
    baseline: { totals_t: base.result.totals_t, recovery_rate: rb?.recovery_rate ?? null },
    scenario: { totals_t: scen.result.totals_t, recovery_rate: rs?.recovery_rate ?? null },
    reduction_t: {
      scope1: d(tb.scope1_kg, ts.scope1_kg), scope2_location: d(tb.scope2_location_kg, ts.scope2_location_kg), scope2_market: d(tb.scope2_market_kg, ts.scope2_market_kg),
      scope3_assessed: d(tb.scope3_assessed_kg, ts.scope3_assessed_kg), scope1_2_location: d(tb.scope1_2_location_kg, ts.scope1_2_location_kg),
    },
    delta_recovery_pts: rb && rs && rb.recovery_rate != null && rs.recovery_rate != null ? (rs.recovery_rate - rb.recovery_rate) * 100 : null,
    forward_looking: true,
    result_hash: scen.manifest.result_hash,
  };
}
