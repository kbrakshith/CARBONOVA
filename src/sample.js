// Worked sample inputs used by the demo, the UI "load example" button and the tests.
// Figures are ILLUSTRATIVE, not data from a real unit.

const evidence = (id, hash, confidence = 0.97) => ({ id, hash, extraction_confidence: confidence, user_confirmed: true });

/** Hypothetical mid-size aluminium products unit, FY 2026-27. */
export function sampleAluminiumUnit() {
  return {
    gwp_set: 'AR6',
    organisation: {
      legal_name: 'Demo Alloys Pvt Ltd (illustrative)', industry: 'aluminium', consolidation_approach: 'operational_control',
      reporting_fy: '2026-27', revenue_inr: 480_000_000,
      facilities: [{ id: 'F1', name: 'Smelter & casthouse', state: 'Odisha' }],
      exclusions: ['Employee commuting not assessed (immaterial for pilot)'],
    },
    activities: [
      { id: 'E-APR', type: 'electricity', facility_id: 'F1', meter_id: 'M1', period: { start: '2026-04-01', end: '2026-04-30' }, grid_import_kwh: 410000, solar_generated_kwh: 30000, solar_self_consumed_kwh: 30000, solar_exported_kwh: 0, evidence: evidence('doc-e-apr', 'sha-e-apr'), data_quality: 'measured' },
      { id: 'E-MAY', type: 'electricity', facility_id: 'F1', meter_id: 'M1', period: { start: '2026-05-01', end: '2026-05-31' }, grid_import_kwh: 428000, solar_generated_kwh: 34000, solar_self_consumed_kwh: 32000, solar_exported_kwh: 2000, evidence: evidence('doc-e-may', 'sha-e-may'), data_quality: 'measured' },
      { id: 'D-APR', type: 'fuel', facility_id: 'F1', fuel: 'diesel', use: 'stationary', ownership: 'owned', quantity: 400, unit: 'L', period: { start: '2026-04-01', end: '2026-04-30' }, evidence: evidence('doc-d-apr', 'sha-d-apr'), data_quality: 'measured' },
      { id: 'P-APR', type: 'fuel', facility_id: 'F1', fuel: 'petrol', use: 'mobile', ownership: 'owned', quantity: 600, unit: 'L', period: { start: '2026-04-01', end: '2026-04-30' }, evidence: evidence('doc-p-apr', 'sha-p-apr'), data_quality: 'measured' },
      { id: 'L-APR', type: 'fuel', facility_id: 'F1', fuel: 'lpg', use: 'stationary', ownership: 'owned', quantity: 285, unit: 'kg', period: { start: '2026-04-01', end: '2026-04-30' }, evidence: evidence('doc-l-apr', 'sha-l-apr'), data_quality: 'measured' },
      { id: 'T-APR', type: 'fuel', facility_id: 'F1', fuel: 'diesel', use: 'mobile', ownership: 'third_party', scope3_category: 4, quantity: 900, unit: 'L', period: { start: '2026-04-01', end: '2026-04-30' }, evidence: evidence('doc-t-apr', 'sha-t-apr'), data_quality: 'estimated', estimation_basis: 'Transporter fuel statements, pro-rated to our trips' },
      { id: 'R-AC', type: 'refrigerant', facility_id: 'F1', refrigerant: 'R-410A', quantity: 6, unit: 'kg', period: { start: '2026-06-01', end: '2026-06-30' }, evidence: evidence('doc-r-ac', 'sha-r-ac'), data_quality: 'measured' },
    ],
    waste: {
      final_product_t: 1000, // semi-finished aluminium
      stages: {
        casting: { wastes: { dross: { tonnes: 21, route: 'recycling', location: 'offsite', facility: 'Authorised dross recycler (SPCB auth. no. pending)' } } },
        smelting: {
          wastes: { spent_pot_lining: { tonnes: 26, route: 'secure_landfill', location: 'offsite', facility: 'TSDF - Demo Region' } },
          process_emissions: [{ gas: 'CO2', kg: 1_580_000, basis_note: 'Anode carbon mass balance' }, { gas: 'CF4', kg: 320, basis_note: 'Anode-effect minutes x slope coefficient (IPCC Tier 2)' }],
        },
      },
      general_waste: [
        { id: 'canteen', label: 'Canteen food waste', waste_class: 'food_organic', tonnes: 18, route: 'composting', location: 'onsite' },
        { id: 'e_waste', label: 'IT e-waste', waste_class: 'e_waste', tonnes: 0.4, route: 'recycling', location: 'offsite', facility: 'Registered e-waste recycler' },
      ],
      disposal_site: { rainfall_mm: 1500, methane_recovered_fraction: 0 },
    },
    scope3_screening: { 1: { status: 'excluded', reason: 'Spend data not yet collected; planned for next cycle' } },
  };
}
