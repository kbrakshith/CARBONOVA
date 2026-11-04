import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { sampleAluminiumUnit } from '../src/sample.js';

let app, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'carbonova-s-'));
  app = createApp({ dataDir: dir });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app.server.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};

test('API: preview, scenario and recommendations are stateless and tenant-scoped', async () => {
  const s = sampleAluminiumUnit();
  const org = (await call('POST', '/api/orgs', s.organisation)).data;
  for (const a of s.activities) await call('POST', `/api/orgs/${org.id}/activities`, a, org.token);
  await call('PUT', `/api/orgs/${org.id}/waste`, s.waste, org.token);
  const auditBefore = (await call('GET', `/api/orgs/${org.id}/audit`, null, org.token)).data.entries.length;

  const pv = await call('POST', `/api/orgs/${org.id}/preview`, {}, org.token);
  assert.equal(pv.status, 200);
  assert.ok(pv.data.result.totals_t.scope1_t > 0);

  const edited = structuredClone(s.waste);
  edited.final_product_t = 2000;
  const pv2 = await call('POST', `/api/orgs/${org.id}/preview`, { waste: edited }, org.token);
  assert.ok(pv2.data.result.waste.chain.summary.total_waste_t_known > pv.data.result.waste.chain.summary.total_waste_t_known);

  const stored = (await call('GET', `/api/orgs/${org.id}`, null, org.token)).data;
  assert.equal(stored.inventory.waste.final_product_t, 1000, 'preview must not persist');
  assert.equal(stored.runs.length, 0);
  assert.equal((await call('GET', `/api/orgs/${org.id}/audit`, null, org.token)).data.entries.length, auditBefore);

  const sc = await call('POST', `/api/orgs/${org.id}/scenario`, { levers: { solar_kwp_added: 50 } }, org.token);
  assert.ok(sc.data.reduction_t.scope2_location > 0);
  const rc = await call('POST', `/api/orgs/${org.id}/recommendations`, {}, org.token);
  assert.ok(rc.data.actions.length >= 2);
  const bad = await call('POST', `/api/orgs/${org.id}/scenario`, { levers: { route_shifts: [{ stream_id: 'x', to_route: 'nope' }] } }, org.token);
  assert.equal(bad.status, 422);
  assert.equal((await call('POST', `/api/orgs/${org.id}/scenario`, {}, 'wrong')).status, 401);
});
