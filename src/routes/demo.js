import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractDocument, makePdf } from '../extract/index.js';

// ILLUSTRATIVE demo workspace: a small iron-casting unit in Coimbatore, Tamil Nadu. Every figure is invented for
// demonstration. Nothing here is real data, and it uses the same provisional factors as any other workspace.

const pad = (n) => String(n).padStart(2, '0');
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthsOf = (fy, upTo) => {
  const y = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; return { y: m >= 4 ? y : y + 1, m }; }).filter((x) => `${x.y}-${pad(x.m)}` <= upTo);
};
// deterministic pseudo-variation so the numbers look like real bills without randomness
const wobble = (seed, spread) => 1 + (((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * spread;

export function buildDemo({ store, docDir }) {
  const profile = {
    legal_name: 'Kaveri Precision Castings Pvt Ltd (demo)', industry: 'foundry', consolidation_approach: 'operational_control', reporting_fy: '2026-27', revenue_inr: 186_000_000,
    business_type: 'Small enterprise - manufacturing', state: 'Tamil Nadu', location: 'Coimbatore',
    facilities: [{ id: 'F1', name: 'Coimbatore foundry', state: 'Tamil Nadu', type: 'Plant' }, { id: 'F2', name: 'Chennai dispatch yard', state: 'Tamil Nadu', type: 'Warehouse' }],
    contact: { name: 'Meenakshi R', email: 'accounts@kaveri-demo.example', phone: '' }, exclusions: ['Employee commuting not assessed'],
  };
  const { id, token } = store.create(profile);
  const doc = store.load(id, token);
  doc.demo = true;
  doc.onboarding = { step: 8, done: true };
  doc.prefs = { user: { name: 'Meenakshi R', email: 'accounts@kaveri-demo.example', role: 'owner' }, notifications: { email_digest: true, doc_review: true, missing_data: true }, retention_days: 1825 };
  doc.team = [{ id: 'U-1', name: 'Meenakshi R', email: 'accounts@kaveri-demo.example', role: 'owner', added_at: new Date().toISOString() }];
  const acts = [];
  let n = 0;
  const add = (a) => { acts.push({ id: `A-${++n}`, facility_id: 'F1', data_quality: 'measured', review_status: 'confirmed', created_from: 'demo', ...a }); };

  const CUR_TO = '2026-10';
  for (const [fy, to] of [['2025-26', '2026-03'], ['2026-27', CUR_TO]]) {
    for (const { y, m } of monthsOf(fy, to)) {
      const k = y * 12 + m; const start = `${y}-${pad(m)}-01`; const end = `${y}-${pad(m)}-${pad(monthEnd(y, m))}`;
      const summer = [4, 5, 6].includes(m) ? 1.12 : [12, 1, 2].includes(m) ? 0.93 : 1;
      const prior = fy === '2025-26' ? 1.04 : 1; // last year slightly higher: the demo shows an improvement
      const skipElec = fy === '2026-27' && m === 10; // October bill not entered yet -> shows up as missing
      if (!skipElec) add({ type: 'electricity', kind: 'electricity', label: `Grid electricity ${y}-${pad(m)}`, meter_id: 'TN-CBE-0412', period: { start, end }, grid_import_kwh: Math.round(41000 * summer * prior * wobble(k, 0.14)), evidence: { id: `EB_${y}_${pad(m)}.pdf`, hash: `demo-eb-${k}`, user_confirmed: true } });
      add({ type: 'fuel', kind: 'diesel', label: `Diesel - DG set ${y}-${pad(m)}`, fuel: 'diesel', use: 'stationary', ownership: 'owned', quantity: Math.round(210 * prior * wobble(k + 1, 0.5)), unit: 'L', period: { start, end }, asset: '125 kVA DG set', evidence: { id: `DSL_${y}_${pad(m)}.pdf`, hash: `demo-dsl-${k}`, user_confirmed: true } });
      add({ type: 'fuel', kind: 'petrol', label: `Petrol - pool vehicles ${y}-${pad(m)}`, fuel: 'petrol', use: 'mobile', ownership: 'owned', quantity: Math.round(135 * wobble(k + 2, 0.3)), unit: 'L', period: { start, end } });
      add({ type: 'fuel', kind: 'lpg', label: `LPG - canteen and furnace pre-heat ${y}-${pad(m)}`, fuel: 'lpg', use: 'stationary', ownership: 'owned', quantity: Math.round(142 * wobble(k + 3, 0.2)), unit: 'kg', period: { start, end } });
      add({ type: 'fuel', kind: 'transport', label: `Outbound trucking (hired) ${y}-${pad(m)}`, fuel: 'diesel', use: 'mobile', ownership: 'third_party', scope3_category: 4, quantity: Math.round(520 * wobble(k + 4, 0.35)), unit: 'L', period: { start, end }, facility_id: 'F2', data_quality: 'estimated', estimation_basis: 'Transporter fuel statements, pro-rated to our consignments' });
    }
  }
  add({ type: 'refrigerant', kind: 'refrigerant', label: 'Office AC top-up', refrigerant: 'R-410A', quantity: 3.5, unit: 'kg', period: { start: '2026-06-18', end: '2026-06-18' }, evidence: { id: 'AC_service_Jun.pdf', hash: 'demo-ac-1', user_confirmed: true } });
  doc.inventory.activities = acts;

  const W = (label, waste_class, tonnes, route, location, start, extra = {}) => ({ id: `W-${(doc.inventory.waste?.general_waste?.length ?? 0) + 1}`, label, waste_class, tonnes, route, location, period: { start, end: start }, review_status: 'confirmed', data_quality: 'measured', ...extra });
  const gw = [];
  const addW = (...a) => { const w = W(...a); w.id = `W-${gw.length + 1}`; gw.push(w); };
  addW('Metal scrap sold to recycler', 'metal_scrap', 11.8, 'recycling', 'offsite', '2026-06-30', { facility_id: 'F1' });
  addW('Packaging plastic (EPR channel)', 'plastic', 0.9, 'recycling', 'offsite', '2026-06-30', { facility_id: 'F1' });
  addW('Canteen food waste', 'food_organic', 1.6, 'composting', 'onsite', '2026-09-30', { facility_id: 'F1' });
  addW('Used oil to registered recycler', 'used_oil', 0.55, 'recycling', 'offsite', '2026-09-30', { facility_id: 'F1', facility: 'CPCB-registered used-oil recycler (auth. no. to be added)' });
  addW('Mixed office and floor sweepings', 'paper_cardboard', 2.4, 'landfill_managed', 'offsite', '2026-09-30', { facility_id: 'F1' });
  addW('Mixed office and floor sweepings (2025-26)', 'paper_cardboard', 4.7, 'landfill_managed', 'offsite', '2025-12-31', { facility_id: 'F1' });
  doc.inventory.waste = {
    final_product_t: 260, // good castings so far this FY
    stages: { casting: { wastes: { used_sand: { tonnes: 214, route: 'other_recovery', location: 'offsite', facility: 'Brick and road-base user (demo)' } } } },
    general_waste: gw, disposal_site: { rainfall_mm: 950, methane_recovered_fraction: 0 },
  };

  // Documents: real generated text-layer PDFs, so preview and extraction genuinely run.
  doc.documents = [];
  const dir = docDir(id);
  const addDoc = (name, doc_type, lines, status, activityIds = []) => {
    const buf = makePdf(lines);
    const hash = createHash('sha256').update(buf).digest('hex');
    const file = path.join(dir, `${hash}.bin`);
    writeFileSync(file, buf);
    const ex = extractDocument(buf, { docType: doc_type, name });
    doc.documents.push({ id: `D-${doc.documents.length + 1}`, name, doc_type, mime: 'application/pdf', size: buf.length, sha256: hash, uploaded_at: new Date().toISOString(), status, extraction: { service: ex.service, fields: ex.fields, rows: ex.rows, notes: ex.notes, has_text: !!ex.text, text: ex.text }, activity_ids: activityIds, file_path: file, demo: true });
  };
  addDoc('Electricity_Bill_October_2026.pdf', 'electricity_bill', ['TANGEDCO DEMO ELECTRICITY BOARD (illustrative)', 'Consumer No: 07-412-3398', 'Bill date: 03/11/2026', 'Billing period: 01/10/2026 to 31/10/2026', 'Units consumed   44,260', 'Previous reading 812,000   Current reading 856,260'], 'needs_review');
  addDoc('Diesel_Receipt_Oct_2026.pdf', 'fuel_receipt', ['Sri Murugan Fuels (demo)', 'Date: 14/10/2026', 'Product: HSD Diesel', 'Quantity 230 litres'], 'needs_review');
  // a document whose values were low-confidence: no readable quantity
  addDoc('Transport_Receipt_Oct.pdf', 'transport_receipt', ['Lakshmi Logistics (demo)', 'Trip sheet 19/10/2026', 'Consignment to Chennai yard'], 'needs_review');
  const sep = acts.find((a) => a.label === 'Grid electricity 2026-09');
  if (sep) addDoc('Electricity_Bill_September_2026.pdf', 'electricity_bill', ['TANGEDCO DEMO ELECTRICITY BOARD (illustrative)', 'Consumer No: 07-412-3398', 'Billing period: 01/09/2026 to 30/09/2026', `Units consumed ${sep.grid_import_kwh.toLocaleString('en-IN')}`], 'confirmed', [sep.id]);

  doc.inventory.activities = acts;
  store.audit(doc, 'demo.loaded', 'system', { note: 'illustrative data' });
  store.save(doc);
  return { id, token };
}
