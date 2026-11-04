import { BRSR_CATEGORIES, WASTE_CLASSES, ROUTES } from '../waste/taxonomy.js';

const STATUS_LABEL = {
  draft: 'DRAFT - not for submission',
  self_declared: 'Self-declared by the reporting organisation (not verified)',
  internally_reviewed: 'Internally reviewed (not externally assured)',
  externally_assured: 'Externally assured',
};

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (kg, d = 3) => (kg / 1000).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const n = (x, d = 2) => (x == null ? '-' : Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** Throws if the requested status is not allowed for this run: a provisional-factor report can never be "reviewed". */
export function assertStatusAllowed(eligibility, status) {
  if (status === 'externally_assured') throw new Error('externally_assured can only be recorded by an independent assurer, not by this system.');
  if (!eligibility.allowed_statuses.includes(status)) {
    const why = eligibility.blocking.length
      ? `blocking issues: ${eligibility.blocking.map((b) => b.code).join(', ')}`
      : `provisional factors: ${eligibility.provisional_factors.join(', ')}`;
    throw new Error(`Status "${status}" not allowed (${why}).`);
  }
}

export function buildReportHtml({ result, manifest, eligibility }, { status = 'draft', version = 1, issuedBy = null, issuedAt = null, narrative = null } = {}) {
  assertStatusAllowed(eligibility, status);
  const r = result;
  const draftMark = status === 'draft' || eligibility.provisional_factors.length;
  const rows = (arr) => arr.join('');
  const lineRows = (scope) => rows(r.lines.filter((l) => l.scope === scope).map((l) => `<tr><td>${esc(l.activity_id)}</td><td>${esc(l.method)}</td><td class="num">${esc(l.quantity_basis ?? `${n(l.quantity, 3)} ${l.unit}`)}</td><td>${esc(l.factor_id)}</td><td>${esc(l.data_quality)}</td><td class="num">${t(l.co2eKg)}</td></tr>`));
  const w = r.waste;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Supplier emissions data - ${esc(r.organisation)} FY ${esc(r.reporting_fy)}</title>
<style>
body{font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#1c2b22;max-width:980px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #2f7d4f;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:13px}th,td{border:1px solid #cfd8d2;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#eef4f0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.status{padding:10px 14px;border-left:6px solid ${draftMark ? '#b45309' : '#2f7d4f'};background:${draftMark ? '#fff7ed' : '#f0faf4'};margin:12px 0}
.kpi{display:flex;gap:12px;flex-wrap:wrap}.kpi div{flex:1 1 150px;background:#f4f8f5;border:1px solid #cfd8d2;padding:10px;border-radius:6px}
.kpi b{display:block;font-size:20px}small,.muted{color:#5b6b61}code{font-size:12px;word-break:break-all}
@media print{body{max-width:none}h2{break-after:avoid}}
</style></head><body>
<h1>BRSR-aligned supplier emissions data</h1>
<div class="muted">${esc(r.organisation)} &middot; Financial year ${esc(r.reporting_fy)} (1 April - 31 March) &middot; Report version ${esc(version)}</div>
<div class="status"><b>Status: ${esc(STATUS_LABEL[status])}</b><br>
${eligibility.provisional_factors.length ? `<small>Contains ${eligibility.provisional_factors.length} emission factor(s) not yet validated against the original source by a named reviewer, so this report cannot be marked reviewed or assured. This is supplier supporting evidence; it does not transfer any buyer's reporting or assurance responsibility and is not a BRSR filing.</small>` : ''}
${issuedBy ? `<br><small>Issued by ${esc(issuedBy)}${issuedAt ? ` on ${esc(issuedAt)}` : ''}</small>` : ''}</div>

<h2>1. Organisation boundary and reporting period</h2>
<p>Consolidation approach: <b>operational control</b> unless stated otherwise in the boundary record. GWP basis: <b>${esc(manifest.gwp.label)}</b>. Emissions are in tonnes CO<sub>2</sub>e.</p>

<h2>Headline results</h2>
<div class="kpi">
<div>Scope 1<b>${n(r.totals_t.scope1_t, 3)} t</b></div>
<div>Scope 2 (location-based)<b>${n(r.totals_t.scope2_location_t, 3)} t</b></div>
<div>Scope 2 (market-based)<b>${n(r.totals_t.scope2_market_t, 3)} t</b></div>
<div>Scope 3 (assessed categories only)<b>${n(r.totals_t.scope3_assessed_t, 3)} t</b></div>
</div>
<p><b>Scope 1 + 2 (location-based): ${n(r.totals_t.scope1_2_location_t, 3)} tCO<sub>2</sub>e.</b>
${r.intensity ? ` Intensity: ${n(r.intensity.t_co2e_per_inr_million, 4)} tCO<sub>2</sub>e per INR million turnover (${esc(r.intensity.basis)}).` : ' Intensity ratio not shown: turnover not provided.'}
Biogenic CO<sub>2</sub> (reported outside the scopes): ${n(r.totals_t.biogenic_co2_t, 3)} t.</p>
<p class="muted">Data quality: ${r.quality.measured_share == null ? '-' : n(r.quality.measured_share * 100, 1)}% of emissions from measured data, ${r.quality.estimated_share == null ? '-' : n(r.quality.estimated_share * 100, 1)}% estimated.</p>

${narrative ? `<h2>Summary</h2><p>${esc(narrative.text)}</p><p class="muted">${narrative.ai ? 'Drafted with AI assistance from the saved results below, then reviewed and approved by the person issuing this report. ' : ''}The tables in this report are the authoritative figures.</p>` : ''}

<h2>2. Scope 1 - direct emissions</h2>
<table><tr><th>Activity</th><th>Method</th><th class="num">Quantity</th><th>Factor</th><th>Quality</th><th class="num">tCO<sub>2</sub>e</th></tr>${lineRows(1)}</table>

<h2>3. Scope 2 - purchased electricity</h2>
<table><tr><th>Activity</th><th>Method</th><th class="num">Quantity</th><th>Factor</th><th>Quality</th><th class="num">tCO<sub>2</sub>e</th></tr>${lineRows(2)}</table>
<p class="muted">Only grid imports carry the grid factor. On-site solar is evidenced separately. India publishes no residual-mix factor, so market-based equals location-based except where contractual renewable energy is documented.</p>

<h2>4. Scope 3 - value-chain categories (each assessed separately)</h2>
<table><tr><th>#</th><th>Category</th><th>Status</th><th class="num">tCO<sub>2</sub>e</th></tr>
${rows(r.scope3_screening.map((s) => `<tr><td>${s.category}</td><td>${esc(s.name)}</td><td>${esc(s.status.replace('_', ' '))}${s.reason ? `<br><small>${esc(s.reason)}</small>` : ''}</td><td class="num">${s.co2e_t != null ? n(s.co2e_t, 3) : '-'}</td></tr>`))}</table>
<p class="muted">"Not assessed" means no calculation was made. It is not zero. The Scope 3 total above is a partial inventory.</p>

${w ? `<h2>Waste - stage-wise assessment by industry</h2>
<p>Industry profile: <b>${esc(w.chain.industry_label)}</b>. Final product: ${n(w.chain.summary.final_product_t, 1)} t. Waste known: ${n(w.chain.summary.total_waste_t_known, 1)} t (${n(w.chain.summary.waste_per_t_final_product, 3)} t per t final product), of which hazardous ${n(w.chain.summary.hazardous_t, 1)} t. ${w.chain.summary.complete ? '' : `<b>${w.chain.summary.streams_requiring_measurement} stream(s) still need measured quantities.</b>`}</p>
${w.chain.stages.map((s) => `<h3 style="font-size:14px;margin:14px 0 4px">${esc(s.name)} <small>(product: ${esc(s.product)}, ${n(s.product_t, 1)} t; input: ${n(s.chain_input.tonnes, 1)} t ${esc(s.chain_input.label)} - ${esc(s.chain_input.basis.replace(/_/g, ' '))}; mass balance: ${esc(s.mass_balance.status.replace(/_/g, ' '))}${s.mass_balance.unexplained_fraction != null ? `, balance (gases, moisture, unmeasured) ${n(s.mass_balance.unexplained_fraction * 100, 1)}%` : ''})</small></h3>
<table><tr><th>Waste stream</th><th>Class</th><th class="num">Tonnes</th><th>Basis</th><th>Route(s)</th></tr>
${rows(s.streams.map((x) => `<tr><td>${esc(x.label)}${x.hvle ? ' <small>(HVLE)</small>' : ''}${x.reg_item ? `<br><small>${esc(x.reg_item)} - ${esc(x.ref_confidence ?? '')} source</small>` : ''}</td><td>${esc(WASTE_CLASSES[x.waste_class].label)}${x.hazardous ? ' <b>(hazardous)</b>' : ''}</td><td class="num">${x.tonnes == null ? '<b>measurement required</b>' : n(x.tonnes, 2)}${x.range ? `<br><small>${n(x.range.min, 0)} - ${n(x.range.max, 0)}</small>` : ''}</td><td>${esc(x.basis.replace(/_/g, ' '))}</td><td>${esc(x.splits.map((p) => `${ROUTES[p.route].label}${p.route_assumed ? ' (assumed)' : ''}`).join('; '))}</td></tr>`))}</table>`).join('')}

<h2>Waste - BRSR Principle 6 table (tonnes)</h2>
<table><tr><th>Category</th><th class="num">Generated</th><th class="num">Recycled</th><th class="num">Re-used</th><th class="num">Other recovery</th><th class="num">Incineration</th><th class="num">Landfill</th><th class="num">Other disposal</th></tr>
${rows(w.brsr.rows.map((x) => `<tr><td>${esc(BRSR_CATEGORIES[x.key])}</td>${['generated', 'recycled', 'reused', 'other_recovery', 'incineration', 'landfill', 'other_disposal'].map((f) => `<td class="num">${n(x[f], 2)}</td>`).join('')}</tr>`))}
<tr><th>Total</th>${['generated', 'recycled', 'reused', 'other_recovery', 'incineration', 'landfill', 'other_disposal'].map((f) => `<th class="num">${n(w.brsr.total[f], 2)}</th>`).join('')}</tr></table>
<p class="muted">${n(w.brsr.estimated_t, 1)} t of the generated total is benchmark-estimated rather than weighed. ${w.brsr.complete ? '' : `${w.brsr.streams_without_quantity} stream(s) without a quantity are excluded from this table.`} Row labels follow the BRSR Principle 6 waste indicator; confirm against the current SEBI format.</p>
${w.findings.filter((f) => f.severity === 'error' || f.severity === 'warning').length ? `<h3 style="font-size:14px">Waste data findings</h3><ul>${rows(w.findings.filter((f) => f.severity === 'error' || f.severity === 'warning').map((f) => `<li><b>${esc(f.severity)}</b> ${esc(f.code)}: ${esc(f.message)}</li>`))}</ul>` : ''}` : ''}

<h2>5. Emission factors and sources</h2>
<table><tr><th>Factor</th><th>Status</th><th>Source document</th><th>Table</th><th>Valid</th></tr>
${rows(manifest.factors.map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.status)}</td><td>${esc(f.document)}</td><td>${esc(f.table)}</td><td>${esc(f.valid_from ?? '')} .. ${esc(f.valid_to ?? 'open')}</td></tr>`))}</table>

<h2>6. Methodology, assumptions and exclusions</h2>
<ul>
<li>Activity data x emission factor; individual gases converted once using ${esc(manifest.gwp.label)} (CH<sub>4</sub> ${manifest.gwp.values.CH4}, N<sub>2</sub>O ${manifest.gwp.values.N2O}).</li>
<li>Fuel: mass x net calorific value x IPCC 2006 gas-specific factors. Landfill methane: IPCC 2006 first-order decay (time-dependent). Composting, digestion and thermal treatment: IPCC 2006 Vol.5 defaults, reported route by route; avoided emissions are not netted.</li>
<li>No AI model performs any calculation. Every figure is reproducible from the saved calculation manifest.</li>
</ul>
<p><b>Exclusions and items not assessed</b></p><ul>${rows(r.exclusions.map((x) => `<li>${esc(x)}</li>`))}</ul>
${r.warnings.length ? `<p><b>Calculation warnings</b></p><ul>${rows(r.warnings.map((x) => `<li>${esc(x.ref)}: ${esc(x.message)}</li>`))}</ul>` : ''}

<h2>7. Base year and intensity</h2><p>Base year not yet set. Recalculation policy: structural or methodology changes beyond 5% of base-year emissions trigger a documented recalculation.</p>

<h2>8. Status, reproducibility and sign-off</h2>
<table><tr><th>Engine</th><td>${esc(manifest.engine_version)}</td></tr>
<tr><th>Factor register</th><td>${esc(manifest.factor_register.version)} <code>${esc(manifest.factor_register.hash)}</code></td></tr>
<tr><th>Input hash</th><td><code>${esc(manifest.input_hash)}</code></td></tr>
<tr><th>Result hash</th><td><code>${esc(manifest.result_hash)}</code></td></tr>
<tr><th>Formulas</th><td>${esc(Object.values(manifest.formula_versions).join(', '))}</td></tr></table>
<p class="muted">Self-declared, internally reviewed and externally assured are different statuses. This report is: <b>${esc(STATUS_LABEL[status])}</b>. Not a legal opinion, certification or ISO 14064 verification statement.</p>
</body></html>`;
}

export function buildReportCsv({ result }) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['activity_id', 'type', 'scope', 'scope3_category', 'method', 'quantity', 'unit', 'factor_id', 'data_quality', 'evidence_id', 'co2e_kg', 'ch4_kg', 'n2o_kg', 'co2_kg'];
  const lines = result.lines.map((l) => [l.activity_id, l.type, l.scope, l.scope3_category ?? '', l.method, l.quantity, l.unit, l.factor_id, l.data_quality, l.evidence_id ?? '', l.co2eKg.toFixed(3), (l.gases?.CH4 ?? 0).toFixed(4), (l.gases?.N2O ?? 0).toFixed(4), (l.gases?.CO2 ?? 0).toFixed(3)].map(q).join(','));
  return [head.join(','), ...lines].join('\n');
}
