import { computeStageChain } from './stageModel.js';
import { treatmentEmissions } from './treatment.js';
import { validateDeclaredWaste } from './identify.js';
import { brsrWasteTable } from './brsr.js';
import { WASTE_CLASSES, ROUTES } from './taxonomy.js';

/**
 * Full waste assessment for one organisation-period.
 *
 * data: {
 *   industry, final_product_t, stages: {...}            // process-chain waste (stage-wise)
 *   general_waste: [{ id, label, waste_class, tonnes, route, location, facility }]   // site-wide streams outside the chain
 *   disposal_site: { rainfall_mm, methane_recovered_fraction }   // applies to landfill routes
 * }
 */
export function runWaste(data, { gwpSet, reportingYear }) {
  const chain = computeStageChain(data);
  const findings = [...chain.warnings.map((w) => ({ ...w }))];

  const productByStage = Object.fromEntries(chain.stages.map((s) => [s.id, s.product_t]));
  const lines = chain.stages.flatMap((s) => s.streams.map((st) => ({
    ...st, implied_per_t: typeof st.tonnes === 'number' && productByStage[s.id] ? st.tonnes / productByStage[s.id] : null,
  })));

  for (const g of (data.general_waste ?? []).filter((x) => !x.voided)) {
    if (!WASTE_CLASSES[g.waste_class]) { findings.push({ severity: 'error', code: 'UNKNOWN_CLASS', message: `General waste "${g.label}": unknown class ${g.waste_class}` }); continue; }
    if (!(g.tonnes >= 0) || !Number.isFinite(g.tonnes)) { findings.push({ severity: 'error', code: 'INVALID_QUANTITY', message: `General waste "${g.label ?? g.id}": tonnage must be a number >= 0.` }); continue; }
    const route = g.route ?? 'other_disposal';
    if (!ROUTES[route]) { findings.push({ severity: 'error', code: 'UNKNOWN_ROUTE', message: `General waste "${g.label}": unknown route ${route}` }); continue; }
    lines.push({
      stage: 'general', stream_id: g.id ?? `general_${lines.length}`, label: g.label, waste_class: g.waste_class,
      brsr: g.brsr ?? WASTE_CLASSES[g.waste_class].brsr, hazardous: WASTE_CLASSES[g.waste_class].hazardous, hvle: false, regs: [], extra: true,
      tonnes: g.tonnes, basis: 'measured', range: null, implied_per_t: null,
      splits: (g.splits?.length ? g.splits : [{ tonnes: g.tonnes, route, route_assumed: !g.route, location: g.location ?? 'offsite', facility: g.facility ?? null }])
        .map((s) => ({ route_assumed: false, location: 'offsite', facility: null, ...s })),
    });
  }

  findings.push(...validateDeclaredWaste(data.industry, lines));

  const site = data.disposal_site ?? {};
  const climate = site.rainfall_mm == null ? null : site.rainfall_mm >= 1000 ? 'tropical_wet' : 'tropical_dry';

  const emissionLines = [];
  for (const l of lines) {
    for (const sp of l.splits) {
      if (!(sp.tonnes > 0)) continue;
      const e = treatmentEmissions({
        waste_class: l.waste_class, route: sp.route, tonnes_wet: sp.tonnes, climate,
        methane_recovered_fraction: site.methane_recovered_fraction ?? 0, carbon_fraction_override: l.carbon_fraction,
      }, { gwpSet, reportingYear });
      emissionLines.push({
        stage: l.stage, stream_id: l.stream_id, label: l.label, waste_class: l.waste_class, route: sp.route, location: sp.location,
        tonnes: sp.tonnes, basis: l.basis, scope: sp.location === 'onsite' ? 1 : 3, scope3_category: sp.location === 'onsite' ? null : 5,
        gases: e.gases, co2eKg: e.co2eKg, method: e.method, assessed: e.assessed, detail: e.detail,
      });
      for (const w of e.warnings) findings.push({ ...w, severity: w.severity ?? 'warning', stage: l.stage, stream: l.stream_id });
    }
  }

  const brsr = brsrWasteTable(lines);
  const totals = { scope1Kg: 0, scope3Cat5Kg: 0 };
  for (const e of emissionLines) (e.scope === 1 ? (totals.scope1Kg += e.co2eKg) : (totals.scope3Cat5Kg += e.co2eKg));

  return {
    chain, lines: lines.map(({ splits, ...rest }) => ({ ...rest, splits })), emissionLines, brsr, findings, totals,
    process_emissions: chain.stages.flatMap((s) => s.process_emissions.map((p) => ({ stage: s.id, ...p }))),
    not_assessed: [
      ...lines.filter((l) => l.basis === 'measurement_required').map((l) => `Waste stream "${l.label}" (${l.stage}): quantity not provided`),
      ...emissionLines.filter((e) => !e.assessed).map((e) => `GHG for "${e.label}" via ${e.route}: not assessed`),
      ...chain.stages.filter((s) => s.process_emissions_missing).map((s) => `Process emissions at stage "${s.name}": not entered`),
    ],
  };
}
