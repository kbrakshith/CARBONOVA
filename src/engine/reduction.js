import { runInventory } from './calculate.js';
import { runScenario, DEFAULT_SOLAR_YIELD } from './scenario.js';
import { WASTE_CLASSES } from '../waste/taxonomy.js';

/**
 * Ranked reduction actions. Emissions effects come from re-running the real engine on a scenario; money figures
 * come from the ASSUMPTIONS below, which are placeholders to be replaced with the unit's own quotes and tariffs and are
 * echoed back with every action. Nothing here is already reflected in the inventory (forward-looking).
 */
export const DEFAULT_ASSUMPTIONS = {
  tariff_inr_per_kwh: 8, // assumption: replace with your DISCOM energy rate
  diesel_inr_per_l: 92, // assumption
  solar_cost_inr_per_kwp: 50000, // assumption: replace with an installer quote
  solar_yield_kwh_per_kwp_yr: DEFAULT_SOLAR_YIELD, // assumption: site dependent
  solar_om_pct_of_capex: 1, // assumption, per year
  solar_cover_share: 0.6, // share of annualised grid imports the system is sized for
  genset_cut: 0.2, // share of stationary diesel avoided by load management / grid reliability
  led_lighting_share: 0.15, // ILLUSTRATIVE: share of electricity used for lighting. Replace with an energy audit figure
  led_saving_fraction: 0.5, // ILLUSTRATIVE: lighting energy saved by moving to LED
  led_cost_inr_per_annual_kwh: 2, // ILLUSTRATIVE: upfront INR per kWh saved per year. Replace with a quote
  mobile_fuel_cut: 0.08, // ILLUSTRATIVE: vehicle fuel saved by route planning and driver practice
};

const DIVERT_TO = {
  plastic: 'recycling', paper_cardboard: 'recycling', metal_scrap: 'recycling', textile: 'recycling',
  e_waste: 'recycling', battery: 'recycling', used_oil: 'recycling', food_organic: 'composting', garden: 'composting', organic_sludge: 'composting',
};
const POOR_ROUTES = new Set(['landfill_managed', 'landfill_unmanaged_deep', 'landfill_unmanaged_shallow', 'open_burning', 'other_disposal']);

export function recommendations(inv, userAssumptions = {}) {
  const A = { ...DEFAULT_ASSUMPTIONS, ...userAssumptions };
  const base = runInventory(inv).result;
  const out = [];

  const elec = inv.activities.filter((a) => a.type === 'electricity' && !a.voided);
  const recordedDays = Math.min(elec.reduce((s, a) => s + (Date.parse(a.period.end) - Date.parse(a.period.start)) / 86400000 + 1, 0), 365);
  const annualise = recordedDays > 0 ? 365 / recordedDays : 1;
  const imports = elec.reduce((s, a) => s + (a.grid_import_kwh ?? 0), 0);

  if (imports > 0) {
    const annualImport = imports * annualise;
    const kwp = Math.round((annualImport * A.solar_cover_share) / A.solar_yield_kwh_per_kwp_yr);
    const calc = (yieldKwh) => {
      const sc = runScenario(inv, { solar_kwp_added: kwp, solar_yield_kwh_per_kwp_yr: yieldKwh });
      const avoidedT = sc.reduction_t.scope2_location * annualise;
      const kwhYr = Math.min(kwp * yieldKwh, annualImport);
      const saving = kwhYr * A.tariff_inr_per_kwh - (kwp * A.solar_cost_inr_per_kwp * A.solar_om_pct_of_capex) / 100;
      return { avoidedT, saving, kwhYr };
    };
    const mid = calc(A.solar_yield_kwh_per_kwp_yr);
    const lo = calc(A.solar_yield_kwh_per_kwp_yr * 0.85);
    const hi = calc(A.solar_yield_kwh_per_kwp_yr * 1.15);
    const capex = kwp * A.solar_cost_inr_per_kwp;
    out.push({
      id: 'solar', category: 'energy', title: `Rooftop solar, about ${kwp} kWp`,
      detail: `Sized to cover ${Math.round(A.solar_cover_share * 100)}% of annualised grid imports (${Math.round(annualImport).toLocaleString('en-IN')} kWh/yr). Recorded period scaled to a year (x${annualise.toFixed(2)}).`,
      annual_tco2e_avoided: round(mid.avoidedT), range_tco2e: [round(lo.avoidedT), round(hi.avoidedT)],
      upfront_inr: Math.round(capex), annual_saving_inr: Math.round(mid.saving), payback_years: mid.saving > 0 ? round(capex / mid.saving, 1) : null,
      assumptions: pick(A, ['tariff_inr_per_kwh', 'solar_cost_inr_per_kwp', 'solar_yield_kwh_per_kwp_yr', 'solar_om_pct_of_capex', 'solar_cover_share']),
    });
  }

  const dieselL = inv.activities.filter((a) => a.type === 'fuel' && a.fuel === 'diesel' && a.use === 'stationary' && a.ownership === 'owned' && !a.voided && a.unit === 'L').reduce((s, a) => s + a.quantity, 0);
  if (dieselL > 0) {
    const sc = runScenario(inv, { diesel_genset_cut: A.genset_cut });
    const litres = dieselL * annualise * A.genset_cut;
    out.push({
      id: 'genset', category: 'energy', title: `Cut stationary diesel by ${Math.round(A.genset_cut * 100)}%`,
      detail: 'Load scheduling, genset right-sizing, power-factor and grid-reliability fixes. No capex estimated: obtain quotes before committing.',
      annual_tco2e_avoided: round(sc.reduction_t.scope1 * annualise), range_tco2e: null, upfront_inr: null,
      annual_saving_inr: Math.round(litres * A.diesel_inr_per_l), payback_years: null, assumptions: pick(A, ['diesel_inr_per_l', 'genset_cut']),
    });
  }

  for (const l of base.waste?.lines ?? []) {
    if (typeof l.tonnes !== 'number' || l.tonnes <= 0) continue;
    const cls = WASTE_CLASSES[l.waste_class];
    const poor = l.splits.filter((s) => POOR_ROUTES.has(s.route));
    const poorT = poor.reduce((s, x) => s + x.tonnes, 0);
    if (poorT <= 0) continue;
    const to = DIVERT_TO[l.waste_class];
    if (to && !cls.hazardous) {
      const sc = runScenario(inv, { route_shifts: [{ stream_id: l.stream_id, stage: l.stage, to_route: to, share: 1, from_routes: poor.map((p) => p.route) }] });
      out.push({
        id: `waste:${l.stage}/${l.stream_id}`, category: 'waste', title: `${l.label}: move ${round(poorT, 1)} t from disposal to ${to}`,
        detail: `Currently routed to ${poor.map((p) => p.route.replace(/_/g, ' ')).join(', ')}. Needs a registered ${to === 'recycling' ? 'recycler / EPR channel' : 'composting or biomethanation partner'}.`,
        annual_tco2e_avoided: round(Math.max(sc.reduction_t.scope1 + sc.reduction_t.scope3_assessed, 0)), range_tco2e: null,
        upfront_inr: null, annual_saving_inr: null, payback_years: null, diverted_t: round(poorT, 1), assumptions: {},
      });
    } else if (l.waste_class === 'inorganic_mineral' && poorT > 50) {
      out.push({
        id: `waste:${l.stage}/${l.stream_id}`, category: 'waste', title: `${l.label}: utilise 20% (${round(poorT * 0.2, 0)} t) instead of storage`,
        detail: 'Bulk mineral residue (e.g. slag, red mud, rejects) can go to cement, bricks, road base or backfill under SPCB approval. No methane benefit; the gain is landfill / storage diversion.',
        annual_tco2e_avoided: 0, range_tco2e: null, upfront_inr: null, annual_saving_inr: null, payback_years: null, diverted_t: round(poorT * 0.2, 1), assumptions: {},
      });
    }
  }

  if (imports > 0) {
    const kwhSaved = imports * annualise * A.led_lighting_share * A.led_saving_fraction;
    const sc = runScenario(inv, { grid_cut_share: A.led_lighting_share * A.led_saving_fraction });
    const capex = kwhSaved * A.led_cost_inr_per_annual_kwh;
    const saving = kwhSaved * A.tariff_inr_per_kwh;
    out.push({
      id: 'led', category: 'energy', title: 'LED lighting upgrade',
      detail: `Assumes lighting is ${Math.round(A.led_lighting_share * 100)}% of electricity and LED cuts that by ${Math.round(A.led_saving_fraction * 100)}%. These shares are illustrative until you have an energy audit.`,
      annual_tco2e_avoided: round(sc.reduction_t.scope2_location * annualise), range_tco2e: null, upfront_inr: Math.round(capex), annual_saving_inr: Math.round(saving), payback_years: saving > 0 ? round(capex / saving, 1) : null,
      assumptions: pick(A, ['led_lighting_share', 'led_saving_fraction', 'led_cost_inr_per_annual_kwh', 'tariff_inr_per_kwh']),
    });
  }

  const mobileL = inv.activities.filter((a) => a.type === 'fuel' && a.use === 'mobile' && !a.voided && a.unit === 'L').reduce((s, a) => s + a.quantity, 0);
  if (mobileL > 0) {
    const sc = runScenario(inv, { mobile_fuel_cut: A.mobile_fuel_cut });
    out.push({
      id: 'transport', category: 'transport', title: `Route planning and driver practice (${Math.round(A.mobile_fuel_cut * 100)}% less vehicle fuel)`,
      detail: 'Fewer empty runs, load consolidation and steady driving. Covers your own vehicles and fuel bought for hired transport. No capex estimated.',
      annual_tco2e_avoided: round((sc.reduction_t.scope1 + sc.reduction_t.scope3_assessed) * annualise), range_tco2e: null, upfront_inr: null,
      annual_saving_inr: Math.round(mobileL * annualise * A.mobile_fuel_cut * A.diesel_inr_per_l), payback_years: null, assumptions: pick(A, ['mobile_fuel_cut', 'diesel_inr_per_l']),
    });
  }

  // rank: costed actions by payback, then everything else by tCO2e avoided, then diverted tonnes
  out.sort((a, b) => {
    const pa = a.payback_years, pb = b.payback_years;
    if (pa != null && pb != null) return pa - pb;
    if (pa != null) return -1;
    if (pb != null) return 1;
    return (b.annual_tco2e_avoided - a.annual_tco2e_avoided) || ((b.diverted_t ?? 0) - (a.diverted_t ?? 0));
  });
  const share = (t) => (base.totals_t.scope1_2_3_assessed_t > 0 ? Math.round((t / base.totals_t.scope1_2_3_assessed_t) * 100) : 0);
  const META = {
    solar: { effort: 'High', confidence: 'Medium', why: `Purchased electricity is ${share(base.totals_t.scope2_location_t)}% of your assessed footprint.` },
    led: { effort: 'Low', confidence: 'Low', why: 'Lighting is usually a quick, low-risk saving in electricity-heavy units. The lighting share here is an assumption.' },
    genset: { effort: 'Medium', confidence: 'Low', why: 'Diesel generators burn fuel at your site, so every litre saved is a direct Scope 1 saving.' },
    transport: { effort: 'Low', confidence: 'Low', why: 'Vehicle fuel is a visible, controllable cost with no equipment to buy.' },
  };
  for (const a of out) Object.assign(a, META[a.id] ?? { effort: a.category === 'waste' ? 'Medium' : 'Medium', confidence: 'Medium', why: a.category === 'waste' ? 'This stream is going to a weaker disposal route than recycling or recovery.' : '' });
  return { assumptions: A, forward_looking: true, note: 'Savings and costs are planning estimates from the assumptions shown. They are not reflected in the inventory.', actions: out.map((x, i) => ({ rank: i + 1, ...x })) };
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
