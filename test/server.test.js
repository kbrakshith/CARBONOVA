import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { verifyAuditChain } from '../src/store.js';
import { sampleAluminiumUnit } from '../src/sample.js';

let app, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'carbonova-'));
  app = createApp({ dataDir: dir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
const getText = (url, token) => fetch(base + url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.text());
const newOrg = async (over = {}) => {
  const s = sampleAluminiumUnit().organisation;
  const r = await call('POST', '/api/orgs', { ...s, ...over });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};

test('public catalog exposes industries, factors with status, regulations', async () => {
  const { status, data } = await call('GET', '/api/catalog');
  assert.equal(status, 200);
  assert.ok(data.industries.some((i) => i.id === 'aluminium'));
  assert.ok(data.factors.every((f) => f.status));
  const ind = await call('GET', '/api/industries/aluminium');
  assert.equal(ind.data.stages.length, 4);
  assert.ok(ind.data.stages[2].streams.some((s) => s.stream_id === 'spent_pot_lining'));
  assert.equal((await call('GET', '/api/industries/nope')).status, 404);
  const id = await call('POST', '/api/waste/identify', { text: 'red mud', industry: 'aluminium' });
  assert.equal(id.data.matches[0].stream_id, 'red_mud');
});

test('organisation creation validates the boundary', async () => {
  const bad = await call('POST', '/api/orgs', { legal_name: 'X', industry: 'aluminium', reporting_fy: '2026', facilities: [] });
  assert.equal(bad.status, 400);
  const bad2 = await call('POST', '/api/orgs', { legal_name: 'X', industry: 'unknown', reporting_fy: '2026-27', facilities: [{ id: 'F' }] });
  assert.equal(bad2.status, 400);
});

test('tenant isolation: one organisation cannot read or write another', async () => {
  const a = await newOrg(); const b = await newOrg();
  assert.equal((await call('GET', `/api/orgs/${a.id}`, null, a.token)).status, 200);
  assert.equal((await call('GET', `/api/orgs/${a.id}`, null, b.token)).status, 401);
  assert.equal((await call('GET', `/api/orgs/${a.id}`)).status, 401);
  assert.equal((await call('POST', `/api/orgs/${a.id}/calculate`, {}, b.token)).status, 401);
  assert.equal((await call('GET', '/api/orgs/org_0000000000000000', null, a.token)).status, 404);
  assert.equal((await call('GET', '/api/orgs/..%2f..%2fetc', null, a.token)).status, 404);
});

test('activities: validated on entry, duplicates and overlaps rejected, void keeps the record', async () => {
  const o = await newOrg();
  const [e1] = sampleAluminiumUnit().activities;
  assert.equal((await call('POST', `/api/orgs/${o.id}/activities`, e1, o.token)).status, 201);
  const dupEvidence = await call('POST', `/api/orgs/${o.id}/activities`, { ...e1, id: 'E2', period: { start: '2026-06-01', end: '2026-06-30' } }, o.token);
  assert.equal(dupEvidence.status, 422);
  assert.ok(dupEvidence.data.errors.some((x) => x.code === 'DUPLICATE_EVIDENCE'));
  const overlap = await call('POST', `/api/orgs/${o.id}/activities`, { ...e1, id: 'E3', evidence: { id: 'z', hash: 'z' } }, o.token);
  assert.equal(overlap.status, 422);
  const badUnit = await call('POST', `/api/orgs/${o.id}/activities`, { id: 'U', type: 'fuel', facility_id: 'F1', fuel: 'coal', use: 'stationary', ownership: 'owned', quantity: 5, unit: 'L', period: { start: '2026-07-01', end: '2026-07-31' } }, o.token);
  assert.equal(badUnit.status, 422);
  assert.equal((await call('POST', `/api/orgs/${o.id}/activities/${e1.id}/void`, {}, o.token)).status, 400);
  assert.equal((await call('POST', `/api/orgs/${o.id}/activities/${e1.id}/void`, { reason: 'Wrong meter' }, o.token)).status, 200);
  const doc = await call('GET', `/api/orgs/${o.id}`, null, o.token);
  assert.equal(doc.data.inventory.activities[0].voided.reason, 'Wrong meter');
});

test('end to end: calculate, reproduce, report gating, audit chain', async () => {
  const sample = sampleAluminiumUnit();
  const o = await newOrg();
  for (const a of sample.activities) assert.equal((await call('POST', `/api/orgs/${o.id}/activities`, a, o.token)).status, 201, a.id);
  assert.equal((await call('PUT', `/api/orgs/${o.id}/waste`, sample.waste, o.token)).status, 200);

  const calc = await call('POST', `/api/orgs/${o.id}/calculate`, {}, o.token);
  assert.equal(calc.status, 200);
  assert.ok(calc.data.result.totals_t.scope1_t > 0);
  assert.ok(calc.data.report_eligibility.allowed_statuses.includes('self_declared'));

  const verify = await call('GET', `/api/orgs/${o.id}/runs/${calc.data.run_id}/verify`, null, o.token);
  assert.equal(verify.data.reproducible, true);

  const rid = calc.data.run_id;
  assert.equal((await call('POST', `/api/orgs/${o.id}/reports`, { run_id: rid, status: 'internally_reviewed', issued_by: 'A. Reviewer' }, o.token)).status, 422, 'provisional factors forbid reviewed status');
  assert.equal((await call('POST', `/api/orgs/${o.id}/reports`, { run_id: rid, status: 'externally_assured', issued_by: 'x' }, o.token)).status, 422);
  assert.equal((await call('POST', `/api/orgs/${o.id}/reports`, { run_id: rid, status: 'self_declared' }, o.token)).status, 400, 'needs a responsible person');
  assert.equal((await call('POST', `/api/orgs/${o.id}/reports`, { run_id: rid, status: 'self_declared', issued_by: 'Owner' }, o.token)).status, 201);

  const html = await getText(`/api/orgs/${o.id}/reports/1/html`, o.token);
  assert.match(html, /BRSR-aligned supplier emissions data/);
  assert.match(html, /Self-declared/);
  assert.match(html, /Spent pot lining/);
  assert.match(html, /not assessed/i);
  assert.doesNotMatch(html, /BRSR-compliant|assured by/i);
  const csv = await getText(`/api/orgs/${o.id}/reports/1/csv`, o.token);
  assert.match(csv.split('\n')[0], /activity_id/);

  const audit = await call('GET', `/api/orgs/${o.id}/audit`, null, o.token);
  assert.equal(audit.data.chain.ok, true);
  assert.ok(audit.data.entries.some((e) => e.action === 'report.issued'));
  const tampered = structuredClone(audit.data.entries); tampered[2].detail = { id: 'forged' };
  assert.equal(verifyAuditChain(tampered).ok, false);
});

test('report HTML escapes organisation text (no script injection)', async () => {
  const o = await newOrg({ legal_name: '<script>alert(1)</script> Ltd' });
  const calc = await call('POST', `/api/orgs/${o.id}/calculate`, {}, o.token);
  assert.equal((await call('POST', `/api/orgs/${o.id}/reports`, { run_id: calc.data.run_id, status: 'draft' }, o.token)).status, 201);
  const html = await getText(`/api/orgs/${o.id}/reports/1/html`, o.token);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('static files served, traversal blocked, bad JSON handled', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404);
  const res = await fetch(`${base}/api/orgs`, { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
});
