import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { makePdf, extractDocument, pdfText, detectKind, parseCsv } from '../src/extract/index.js';
import { inventoryForFy, fyOf, availableFys } from '../src/engine/periods.js';
import { runInventory } from '../src/engine/calculate.js';

let app, base, dir, id, token;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'carbonova-a-'));
  app = createApp({ dataDir: path.join(dir, 'orgs') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  ({ id, token } = (await call('POST', '/api/demo')).data);
});
after(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (method, url, body, tok = token) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
const org = (p) => `/api/orgs/${id}${p}`;
const b64 = (buf) => Buffer.from(buf).toString('base64');

test('periods: FY assignment and per-year inventories', () => {
  assert.equal(fyOf('2026-03-31'), '2025-26');
  assert.equal(fyOf('2026-04-01'), '2026-27');
  const inv = { organisation: { reporting_fy: '2026-27' }, activities: [{ period: { start: '2025-05-01' } }, { period: { start: '2026-05-01' } }], waste: { stages: { x: {} }, general_waste: [{ period: { start: '2025-06-01' } }, { period: { start: '2026-06-01' } }] } };
  assert.deepEqual(availableFys(inv), ['2026-27', '2025-26']);
  const prev = inventoryForFy(inv, '2025-26');
  assert.equal(prev.activities.length, 1);
  assert.deepEqual(prev.waste.stages, {}, 'stage chain data belongs to the current year only');
  assert.equal(inventoryForFy(inv, '2026-27').waste.general_waste.length, 1);
});

test('extraction: real PDF text layer is read; scanned or image input yields empty fields for manual entry', () => {
  const pdf = makePdf(['ACME ELECTRICITY BOARD', 'Consumer No: 55-1234', 'Billing period: 01/08/2026 to 31/08/2026', 'Units consumed 12,345']);
  assert.equal(detectKind(pdf, 'x.pdf'), 'pdf');
  assert.match(pdfText(pdf), /Units consumed 12,345/);
  const ex = extractDocument(pdf, { docType: 'electricity_bill', name: 'x.pdf' });
  const f = Object.fromEntries(ex.fields.map((x) => [x.key, x]));
  assert.equal(f.quantity.value, 12345);
  assert.equal(f.period_start.value, '2026-08-01');
  assert.ok(f.quantity.confidence <= 0.8, 'suggestions never claim certainty');
  const empty = extractDocument(makePdf(['Nothing useful here']), { docType: 'electricity_bill', name: 'y.pdf' });
  assert.ok(empty.fields.find((x) => x.key === 'quantity').confidence === 0);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const img = extractDocument(png, { docType: 'fuel_receipt', name: 'r.png' });
  assert.ok(img.fields.every((x) => x.value === '') && /no OCR/i.test(img.notes[0]));
  assert.equal(detectKind(Buffer.from('MZ not a pdf'), 'evil.pdf'), null);
  const csv = parseCsv('type,start,end,quantity,unit,fuel\nelectricity,2026-05-01,2026-05-31,1000,kWh,\nfuel,2026-05-01,2026-05-31,abc,L,diesel');
  assert.equal(csv.rows[0].errors.length, 0);
  assert.ok(csv.rows[1].errors.some((e) => /quantity/.test(e)));
});

test('demo workspace: summary reconciles with the underlying calculation', async () => {
  const s = (await call('POST', org('/summary'), {})).data;
  assert.equal(s.fy, '2026-27');
  assert.ok(s.previous_fy === '2025-26' && s.comparison);
  const t = s.current.result.totals_t;
  const lineSum = s.current.result.lines.reduce((a, l) => a + l.co2eKg, 0) / 1000;
  assert.ok(Math.abs(t.scope1_2_3_assessed_t - lineSum) < 0.01, 'dashboard total equals sum of calculation lines');
  const bySource = s.by_source.reduce((a, x) => a + x.t, 0);
  assert.ok(Math.abs(bySource - lineSum) < 1e-6, 'source breakdown sums to total');
  const monthly = s.months.reduce((a, m) => a + m.total, 0);
  assert.ok(Math.abs(monthly + s.annual_items_t - lineSum) < 0.01, 'months + annual items = total');
  assert.ok(s.completeness.missing.Electricity.includes('2026-10'), 'the unentered October bill is reported as missing, not zero');
  assert.equal(s.completeness.pending_documents, 3);
  const prev = (await call('POST', org('/summary'), { fy: '2025-26' })).data;
  assert.equal(prev.fy, '2025-26');
  assert.equal(prev.current.result.reporting_fy, '2025-26');
});

test('documents: upload, duplicate rejection, type validation, correct-then-confirm creates a calculated record', async () => {
  const pdf = makePdf(['Sri Ganesh Fuels', 'Date: 05/10/2026', 'HSD Diesel', 'Quantity 80 litres']);
  const up = await call('POST', org('/documents'), { name: 'Receipt_5Oct.pdf', doc_type: 'fuel_receipt', data: b64(pdf) });
  assert.equal(up.status, 201);
  const d = up.data.document;
  assert.equal(d.status, 'needs_review');
  assert.equal(d.extraction.fields.find((f) => f.key === 'quantity').value, 80);

  const dup = await call('POST', org('/documents'), { name: 'Copy.pdf', doc_type: 'fuel_receipt', data: b64(pdf) });
  assert.equal(dup.status, 409);
  const bad = await call('POST', org('/documents'), { name: 'x.pdf', doc_type: 'fuel_receipt', data: b64(Buffer.from('not a pdf at all')) });
  assert.equal(bad.status, 415);
  assert.equal((await call('POST', org('/documents'), { name: 'x.pdf', doc_type: 'nonsense', data: b64(pdf) })).status, 400);
  const file = await fetch(base + org(`/documents/${d.id}/file`), { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');

  const before_ = (await call('POST', org('/summary'), {})).data.current.result.totals_t.scope1_t;
  const noKind = await call('POST', org(`/documents/${d.id}/confirm`), { values: { period_start: '2026-10-05', quantity: 80, unit: 'L', fuel: 'diesel' }, facility_id: 'F1' });
  assert.equal(noKind.status, 400);
  const ok = await call('POST', org(`/documents/${d.id}/confirm`), { kind: 'diesel', facility_id: 'F1', values: { period_start: '2026-10-05', period_end: '2026-10-05', quantity: 85, unit: 'L', fuel: 'diesel' }, corrections: { quantity: { from: 80, to: 85 } }, label: 'Diesel receipt 5 Oct' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const after_ = (await call('POST', org('/summary'), {})).data.current.result.totals_t.scope1_t;
  assert.ok(after_ > before_, 'confirmed values reach the calculation');
  const recs = (await call('GET', org('/records'))).data.records;
  const rec = recs.find((r) => r.id === ok.data.created[0]);
  assert.equal(rec.quantity, 85);
  assert.match(rec.source, /Receipt_5Oct/);
  assert.equal((await call('POST', org(`/documents/${d.id}/confirm`), { kind: 'diesel', values: {} })).status, 409);
});

test('unconfirmed records are excluded from totals; approving them includes them', async () => {
  const mk = await call('POST', org('/records'), { kind: 'petrol', label: 'Petrol - to be checked', facility_id: 'F1', start: '2026-09-10', end: '2026-09-10', quantity: 500, unit: 'L', review_status: 'needs_review' });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const t1 = (await call('POST', org('/summary'), {})).data;
  assert.ok(t1.current.result.exclusions.some((x) => x.includes(mk.data.id) && /awaiting review/.test(x)));
  assert.ok(t1.completeness.pending_records >= 1);
  const before_ = t1.current.result.totals_t.scope1_t;
  assert.equal((await call('POST', org(`/records/${mk.data.id}/review`), { status: 'confirmed' })).status, 200);
  const after_ = (await call('POST', org('/summary'), {})).data.current.result.totals_t.scope1_t;
  assert.ok(after_ > before_);
});

test('records: validation, edit, duplicates flagged, delete requires a reason and keeps history', async () => {
  const bad = await call('POST', org('/records'), { kind: 'diesel', facility_id: 'F1', start: '2026-09-12', quantity: -5, unit: 'L' });
  assert.equal(bad.status, 422);
  const badUnit = await call('POST', org('/records'), { kind: 'lpg', facility_id: 'F1', start: '2026-09-12', quantity: 5, unit: 'kWh' });
  assert.equal(badUnit.status, 422);
  const wrongFacility = await call('POST', org('/records'), { kind: 'diesel', facility_id: 'F9', start: '2026-09-12', quantity: 5, unit: 'L' });
  assert.equal(wrongFacility.status, 422);
  const overlap = await call('POST', org('/records'), { kind: 'electricity', facility_id: 'F1', meter_id: 'TN-CBE-0412', start: '2026-09-10', end: '2026-09-20', quantity: 1000 });
  assert.equal(overlap.status, 422);
  assert.ok(overlap.data.errors.some((e) => e.code === 'PERIOD_OVERLAP'));

  const a = await call('POST', org('/records'), { kind: 'diesel', label: 'Dup test', facility_id: 'F1', start: '2026-09-12', end: '2026-09-12', quantity: 33, unit: 'L' });
  const b = await call('POST', org('/records'), { kind: 'diesel', label: 'Dup test again', facility_id: 'F1', start: '2026-09-12', end: '2026-09-12', quantity: 33, unit: 'L' });
  assert.equal(b.status, 201);
  assert.ok(b.data.warnings.some((w) => w.code === 'POSSIBLE_DUPLICATE'));
  let recs = (await call('GET', org('/records'))).data.records;
  assert.deepEqual(recs.find((r) => r.id === b.data.id).duplicate_of, [a.data.id]);

  assert.equal((await call('PUT', org(`/records/${b.data.id}`), { quantity: 34 })).status, 200);
  recs = (await call('GET', org('/records'))).data.records;
  assert.equal(recs.find((r) => r.id === b.data.id).quantity, 34);
  assert.equal((await call('PUT', org(`/records/${b.data.id}`), { quantity: -1 })).status, 422);

  assert.equal((await call('POST', org(`/records/${b.data.id}/void`), {})).status, 400);
  assert.equal((await call('POST', org(`/records/${b.data.id}/void`), { reason: 'Entered twice' })).status, 200);
  assert.equal((await call('PUT', org(`/records/${b.data.id}`), { quantity: 40 })).status, 409);
  const audit = (await call('GET', org('/audit'))).data;
  assert.ok(audit.chain.ok);
  assert.ok(audit.entries.some((e) => e.action === 'record.deleted' && e.detail.reason === 'Entered twice'));
});

test('waste records: hazardous routing is enforced and records reach the engine', async () => {
  const haz = await call('POST', org('/records'), { kind: 'waste', label: 'Spent solvent', waste_class: 'hazardous_organic', tonnes: 0.2, route: 'landfill_managed', start: '2026-09-30' });
  assert.equal(haz.status, 422);
  assert.ok(haz.data.errors.some((e) => e.code === 'HAZ_ROUTE_NOT_PERMITTED'));
  const ok = await call('POST', org('/records'), { kind: 'waste', label: 'Cardboard', waste_class: 'paper_cardboard', tonnes: 3, route: 'landfill_managed', start: '2026-09-30' });
  assert.equal(ok.status, 201);
  const s = (await call('POST', org('/summary'), {})).data;
  assert.ok(s.current.result.lines.some((l) => l.waste_detail?.stream === 'Cardboard' && l.co2eKg > 0));
});

test('reduction actions: status tracking with history', async () => {
  assert.equal((await call('PUT', org('/actions/solar'), { status: 'bogus' })).status, 400);
  const a = await call('PUT', org('/actions/solar'), { status: 'planned', title: 'Rooftop solar', est_tco2e: 120 });
  assert.equal(a.data.action.status, 'planned');
  const b = await call('PUT', org('/actions/solar'), { status: 'in_progress' });
  assert.equal(b.data.action.history.length, 2);
  assert.equal(b.data.action.est_tco2e, 120);
  assert.equal((await call('GET', org('/actions'))).data.actions.length, 1);
});

test('profile, settings and team', async () => {
  assert.equal((await call('PUT', org('/profile'), { consolidation_approach: 'bogus' })).status, 422);
  assert.equal((await call('PUT', org('/profile'), { facilities: [{ id: 'F1', name: 'Only plant' }] })).status, 422, 'F2 still has records');
  const ok = await call('PUT', org('/profile'), { location: 'Peelamedu, Coimbatore', contact: { name: 'X', email: 'x@y.in' } });
  assert.equal(ok.data.organisation.location, 'Peelamedu, Coimbatore');
  assert.equal((await call('PUT', org('/prefs'), { retention_days: 12 })).status, 400);
  assert.equal((await call('PUT', org('/prefs'), { retention_days: 730 })).data.prefs.retention_days, 730);
  assert.equal((await call('POST', org('/team'), { email: 'nope', role: 'viewer' })).status, 400);
  const m = await call('POST', org('/team'), { email: 'ops@kaveri-demo.example', role: 'preparer', name: 'Ops' });
  assert.equal(m.status, 201);
  assert.equal((await call('POST', org('/team'), { email: 'OPS@kaveri-demo.example', role: 'viewer' })).status, 409);
  assert.equal((await call('POST', org(`/team/${m.data.member.id}/role`), { role: 'reviewer' })).data.member.role, 'reviewer');
  assert.equal((await call('POST', org(`/team/${m.data.member.id}/remove`), {})).status, 200);
});

test('notifications derive from real state and can be marked read', async () => {
  const n = (await call('GET', org('/notifications'))).data.notifications;
  assert.ok(n.some((x) => /waiting for review/.test(x.title)));
  assert.ok(n.some((x) => /Missing electricity/.test(x.title)));
  await call('POST', org('/notifications/read'), { ids: [n[0].id] });
  assert.equal((await call('GET', org('/notifications'))).data.notifications.find((x) => x.id === n[0].id).read, true);
  const feed = (await call('GET', org('/feed'))).data.feed;
  assert.ok(feed.length > 0 && feed[0].text);
});

test('reports: per-year, reissue needs a reason, provisional factors block reviewed', async () => {
  const run = (await call('POST', org('/calculate'), { fy: '2025-26' })).data;
  assert.equal(run.result.reporting_fy, '2025-26');
  const r1 = await call('POST', org('/reports'), { run_id: run.run_id, status: 'self_declared', issued_by: 'Meenakshi R, Owner', name: 'FY 2025-26 supplier data' });
  assert.equal(r1.status, 201);
  assert.equal((await call('POST', org('/reports'), { run_id: run.run_id, status: 'internally_reviewed', issued_by: 'x' })).status, 422);
  assert.equal((await call('POST', org('/reports'), { run_id: run.run_id, status: 'self_declared', issued_by: 'x', supersedes: r1.data.version })).status, 400);
  const r2 = await call('POST', org('/reports'), { run_id: run.run_id, status: 'self_declared', issued_by: 'x', supersedes: r1.data.version, reason: 'Corrected September diesel quantity' });
  assert.equal(r2.status, 201);
  const list = (await call('GET', org(''))).data.reports;
  const v2 = list.find((r) => r.version === r2.data.version);
  assert.equal(v2.supersedes, r1.data.version);
  assert.equal(v2.fy, '2025-26');
  assert.ok(v2.total_t > 0);
  assert.equal(list.find((r) => r.version === r1.data.version).name, 'FY 2025-26 supplier data');
});

test('isolation: another workspace cannot see documents or records', async () => {
  const other = (await call('POST', '/api/demo', null, null)).data;
  assert.equal((await call('GET', org('/records'), null, other.token)).status, 401);
  assert.equal((await call('GET', org('/documents/D-1/file'), null, other.token)).status, 401);
  const mine = (await call('GET', `/api/orgs/${other.id}/records`, null, other.token)).data.records.length;
  assert.ok(mine > 0);
});

test('factor register is public and complete; engine still deterministic on the demo', async () => {
  const f = (await call('GET', '/api/factors', null, null)).data;
  assert.ok(f.factors.length >= 10 && f.hash);
  assert.equal((await call('GET', '/api/factors/EF-IN-GRID-CEA-V20', null, null)).data.status, 'provisional');
  assert.equal((await call('GET', '/api/factors/nope', null, null)).status, 404);
  const inv = (await call('GET', org(''))).data.inventory;
  assert.equal(runInventory(inventoryForFy(inv, '2026-27')).manifest.result_hash, runInventory(inventoryForFy(inv, '2026-27')).manifest.result_hash);
});

test('preview, scenario and recommendations only use the selected financial year', async () => {
  const pv = (await call('POST', org('/preview'), {})).data;
  const sm = (await call('POST', org('/summary'), {})).data;
  assert.equal(pv.result.totals_t.scope1_2_3_assessed_t, sm.current.result.totals_t.scope1_2_3_assessed_t, 'live preview equals the dashboard');
  assert.ok(!pv.result.exclusions.some((x) => /outside reporting year/i.test(x)), 'no prior-year records leak in');
  const rec = (await call('POST', org('/recommendations'), {})).data;
  assert.ok(!rec.actions.some((a) => /2025-26/.test(a.title)), 'prior-year waste records are not recommended on');
  const solar = rec.actions.find((a) => a.id === 'solar');
  assert.ok(solar.detail.includes('Recorded period scaled'), solar.detail);
  const prevRec = (await call('POST', org('/recommendations'), { fy: '2025-26' })).data;
  assert.ok(prevRec.actions.length > 0);
});
