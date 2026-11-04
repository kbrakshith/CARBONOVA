import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { redact } from '../src/ai/groq.js';
import { validateExtraction, validateClassification, validateNarrative } from '../src/ai/tasks.js';
import { loadEnv } from '../src/config.js';
import { makePdf } from '../src/extract/index.js';
import { writeFileSync } from 'node:fs';

const KEY = 'gsk_test_key_do_not_leak_123456';
let app, base, dir, id, token, answer, calls;
const realFetch = globalThis.fetch;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'carbonova-ai-'));
  app = createApp({ dataDir: path.join(dir, 'orgs') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  ({ id, token } = await (await realFetch(`${base}/api/demo`, { method: 'POST' })).json());
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.groq.com')) {
      calls.push({ url: String(url), body: JSON.parse(opts.body), auth: opts.headers.Authorization });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(typeof answer === 'function' ? answer(JSON.parse(opts.body)) : answer) } }] }), { status: 200 });
    }
    return realFetch(url, opts);
  };
});
after(() => { globalThis.fetch = realFetch; delete process.env.GROQ_API_KEY; app.server.close(); rmSync(dir, { recursive: true, force: true }); });

const call = async (m, u, b, t = token) => { const r = await realFetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let d; try { d = JSON.parse(x); } catch { d = x; } return { status: r.status, data: d, raw: x }; };
const org = (p) => `/api/orgs/${id}${p}`;

test('.env loader: reads values, strips quotes and comments, never overrides real environment', () => {
  const f = path.join(dir, 'test.env');
  writeFileSync(f, '# comment\nAI_T1=plain\nAI_T2="quoted value"\nexport AI_T3=x # trailing\nAI_T4=fromfile\n');
  process.env.AI_T4 = 'fromshell';
  assert.equal(loadEnv(f), true);
  assert.deepEqual([process.env.AI_T1, process.env.AI_T2, process.env.AI_T3, process.env.AI_T4], ['plain', 'quoted value', 'x', 'fromshell']);
  assert.equal(loadEnv(path.join(dir, 'missing.env')), false);
});

test('redaction removes emails, phone numbers and long account numbers before text leaves the server', () => {
  const r = redact('Contact accounts@firm.in or 9876543210, A/c 123456789012345, units 4100');
  assert.ok(!/@firm|9876543210|123456789012345/.test(r));
  assert.match(r, /units 4100/);
});

test('extraction validator drops invented values, bad dates and quotes that are not in the document', () => {
  const text = 'ACME POWER\nBilling period: 01/10/2026 to 31/10/2026\nUnits consumed 44,260';
  const ok = validateExtraction('electricity_bill', text, { fields: [
    { key: 'quantity', value: 44260, quote: 'Units consumed 44,260' },
    { key: 'quantity', value: 99999, quote: 'Units consumed 44,260' },
    { key: 'meter_id', value: 'X1', quote: 'Meter X1 not in document' },
    { key: 'period_start', value: '2026-13-45', quote: '01/10/2026' },
    { key: 'period_end', value: '2026-10-31', quote: '31/10/2026' },
    { key: 'secret', value: 'x', quote: 'ACME' },
  ] });
  assert.deepEqual(ok.map((f) => f.key + '=' + f.value), ['quantity=44260', 'period_end=2026-10-31']);
});

test('classification and narrative validators', () => {
  assert.equal(validateClassification({ kind: 'teleporter' }), null);
  assert.equal(validateClassification({ kind: 'Diesel', reason: 'genset' }).kind, 'diesel');
  const facts = { fy: '2026-27', total_tco2e: 263.5, scope1_tco2e: 18.3, scope2_location_tco2e: 226.1 };
  assert.equal(validateNarrative(facts, { text: 'For FY 2026-27 the total was 263.5 tCO2e, of which Scope 1 was 18.3 tCO2e and Scope 2 was 226.1 tCO2e.' }).ok, true);
  assert.equal(validateNarrative(facts, { text: 'For FY 2026-27 the total was 270 tCO2e, which is a good result for the year.' }).ok, false, 'invented number');
  assert.equal(validateNarrative(facts, { text: 'Emissions of 263.5 tCO2e have been independently verified and are compliant.' }).ok, false, 'banned claim');
});

test('AI is off until configured AND switched on per workspace; the key is never exposed', async () => {
  delete process.env.GROQ_API_KEY;
  assert.equal((await call('GET', '/api/ai/status', null, null)).data.configured, false);
  assert.equal((await call('POST', org('/ai/classify'), { description: 'diesel for generator' })).status, 503);
  process.env.GROQ_API_KEY = KEY;
  calls = [];
  const st = await call('GET', '/api/ai/status', null, null);
  assert.equal(st.data.configured, true);
  assert.ok(!st.raw.includes(KEY));
  assert.equal((await call('POST', org('/ai/classify'), { description: 'diesel for generator' })).status, 403, 'workspace has not opted in');
  assert.equal(calls.length, 0, 'nothing was sent to the provider');
  assert.equal((await call('PUT', org('/prefs'), { ai_enabled: true })).data.prefs.ai_enabled, true);
  assert.equal((await call('POST', org('/ai/classify'), {}, 'wrong')).status, 401);
});

test('classify: validated answer, redacted input, key only in the outbound header', async () => {
  answer = { kind: 'diesel', reason: 'Generator fuel' };
  calls = [];
  const r = await call('POST', org('/ai/classify'), { description: 'Bought diesel for DG set, call 9876543210' });
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, 'diesel');
  assert.equal(r.data.source, 'ai');
  assert.ok(!r.raw.includes(KEY));
  assert.equal(calls[0].auth, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(calls[0].body).includes('9876543210'));
  answer = { kind: 'banana' };
  assert.equal((await call('POST', org('/ai/classify'), { description: 'x' })).status, 502);
});

test('document extraction: AI fills only empty fields, low confidence, quoted, never auto-approved', async () => {
  const pdf = makePdf(['Mystery Board', 'Total energy used 12,400 kWh this cycle', 'From 01/08/2026 till 31/08/2026']);
  const up = await call('POST', org('/documents'), { name: 'Bill_Aug.pdf', doc_type: 'electricity_bill', data: pdf.toString('base64') });
  const d = up.data.document;
  assert.equal(d.extraction.fields.find((f) => f.key === 'quantity').confidence, 0.5 === 0 ? 0 : d.extraction.fields.find((f) => f.key === 'quantity').confidence);
  answer = { fields: [{ key: 'quantity', value: 12400, quote: 'Total energy used 12,400 kWh' }, { key: 'meter_id', value: 'Z9', quote: 'meter Z9 invented' }] };
  const r = await call('POST', org(`/ai/extract/${d.id}`), {});
  assert.equal(r.status, 200, r.raw);
  const q = r.data.document.extraction.fields.find((f) => f.key === 'quantity');
  const prior = d.extraction.fields.find((f) => f.key === 'quantity');
  if (prior.value === '') { assert.equal(q.source, 'ai'); assert.equal(q.confidence, 0.5); assert.match(q.source_ref, /AI suggestion/); }
  assert.ok(!r.data.document.extraction.fields.some((f) => f.key === 'meter_id' && f.value === 'Z9'), 'invented meter dropped');
  assert.equal(r.data.document.status, 'needs_review');
  const scanned = await call('POST', org('/documents'), { name: 'Photo.png', doc_type: 'fuel_receipt', data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30)]).toString('base64') });
  assert.equal((await call('POST', org(`/ai/extract/${scanned.data.document.id}`), {})).status, 422, 'no text layer: AI cannot read a photo');
});

test('narrative: accepted only if every number comes from saved results; can be put in a report; claims blocked', async () => {
  answer = (body) => { const f = JSON.parse(body.messages[1].content); return { text: `For FY ${f.fy}, total emissions were ${f.total_tco2e} tCO2e: Scope 1 ${f.scope1_tco2e} and Scope 2 ${f.scope2_location_tco2e}. Scope 3 is a partial inventory.` }; };
  const good = await call('POST', org('/ai/narrative'), {});
  assert.equal(good.status, 200, good.raw);
  assert.equal(good.data.ai_drafted, true);
  answer = { text: 'Emissions fell by 41 percent this year, a strong result for the whole business overall.' };
  assert.equal((await call('POST', org('/ai/narrative'), {})).status, 422);

  const run = (await call('POST', org('/calculate'), {})).data;
  const rep = await call('POST', org('/reports'), { run_id: run.run_id, status: 'self_declared', issued_by: 'Owner', narrative: { text: '<b>Totals</b> as saved. Scope 3 is partial.', ai: true } });
  assert.equal(rep.status, 201, rep.raw);
  const html = await (await realFetch(base + org(`/reports/${rep.data.version}/html`), { headers: { Authorization: `Bearer ${token}` } })).text();
  assert.match(html, /Drafted with AI assistance/);
  assert.ok(!html.includes('<b>Totals</b>') && html.includes('&lt;b&gt;'));
  const bad = await call('POST', org('/reports'), { run_id: run.run_id, status: 'draft', narrative: { text: 'This report is fully verified and compliant with BRSR.' } });
  assert.equal(bad.status, 422);
});
