import http from 'node:http';
import { config } from './config.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, httpError, verifyAuditChain, sha } from './store.js';
import { runInventory } from './engine/calculate.js';
import { validateInventory } from './engine/validate.js';
import { register, listFuels } from './engine/factors.js';
import { GWP_SETS } from './engine/gwp.js';
import { INDUSTRIES, listIndustries, getIndustry } from './waste/industries.js';
import { expectedStreams, identifyByText } from './waste/identify.js';
import { WASTE_CLASSES, ROUTES, BRSR_CATEGORIES, REGULATIONS } from './waste/taxonomy.js';
import { buildReportHtml, buildReportCsv } from './report/report.js';
import { sampleAluminiumUnit } from './sample.js';
import { runScenario } from './engine/scenario.js';
import { recommendations } from './engine/reduction.js';
import { registerApp } from './routes/app.js';
import { registerAi } from './routes/ai.js';
import { hasBannedClaim } from './ai/tasks.js';
import { inventoryForFy } from './engine/periods.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const MAX_BODY = 1_000_000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function createApp({ dataDir = path.join(here, '..', 'data', 'orgs') } = {}) {
  const store = new Store(dataDir);
  const hits = new Map();

  const rateLimit = (req, limit = 20, windowMs = 60_000) => {
    const key = req.socket.remoteAddress ?? 'x';
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) throw httpError(429, 'Too many requests');
    arr.push(now);
    hits.set(key, arr);
  };

  const routes = [];
  const on = (method, pattern, handler, { auth = true, limit = MAX_BODY } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, auth, limit });
  };

  // ---------- public ----------
  on('GET', '/api/catalog', () => ({
    industries: listIndustries(),
    fuels: listFuels(),
    waste_classes: Object.entries(WASTE_CLASSES).map(([id, c]) => ({ id, label: c.label, hazardous: c.hazardous, brsr: c.brsr })),
    routes: Object.entries(ROUTES).map(([id, r]) => ({ id, label: r.label, hazardous_ok: r.hazardous_ok, brsr: r.brsr, prohibited: !!r.prohibited })),
    brsr_categories: BRSR_CATEGORIES, gwp_sets: Object.fromEntries(Object.entries(GWP_SETS).map(([k, v]) => [k, v.label])),
    regulations: REGULATIONS,
    factors: register().factors.map((f) => ({ id: f.id, activity: f.activity, status: f.status, source: f.source.document, valid_from: f.valid_from, valid_to: f.valid_to })),
  }), { auth: false });

  on('GET', '/api/industries/:id', ({ params }) => {
    if (!INDUSTRIES[params.id]) throw httpError(404, 'Unknown industry');
    const p = getIndustry(params.id);
    return { id: params.id, label: p.label, final_product: p.final_product, stages: p.stages.map((s) => ({ id: s.id, name: s.name, product: s.product, chain_input: s.chain_input, process_emissions: s.process_emissions ?? null, process_default: s.process_default ?? null, streams: expectedStreams(params.id, s.id) })) };
  }, { auth: false });

  on('POST', '/api/waste/identify', ({ body }) => ({ matches: identifyByText(body.text ?? '', body.industry && INDUSTRIES[body.industry] ? body.industry : undefined) }), { auth: false });
  on('GET', '/api/sample', () => sampleAluminiumUnit(), { auth: false });

  on('POST', '/api/orgs', ({ body, req }) => {
    rateLimit(req, 10);
    const profile = {
      legal_name: str(body.legal_name, 'legal_name'), industry: body.industry, consolidation_approach: body.consolidation_approach ?? 'operational_control',
      reporting_fy: body.reporting_fy, facilities: body.facilities ?? [], revenue_inr: body.revenue_inr ?? null, exclusions: body.exclusions ?? [],
      business_type: body.business_type ?? null, state: body.state ?? null, location: body.location ?? null, contact: body.contact ?? null,
    };
    if (!INDUSTRIES[profile.industry]) throw httpError(400, `industry must be one of ${Object.keys(INDUSTRIES).join(', ')}`);
    const v = validateInventory({ organisation: profile, activities: [] });
    const blocking = v.errors.filter((e) => e.code.startsWith('BOUNDARY') || e.code === 'REPORTING_PERIOD');
    if (blocking.length) throw httpError(400, 'Invalid organisation boundary', { errors: blocking });
    return { status: 201, body: store.create(profile) };
  }, { auth: false });

  // ---------- organisation-scoped (bearer token) ----------
  const withDoc = (fn) => (ctx) => fn({ ...ctx, doc: store.load(ctx.params.id, ctx.token) });

  on('GET', '/api/orgs/:id', withDoc(({ doc }) => ({ id: doc.id, inventory: doc.inventory, runs: doc.runs.map(({ inventory, ...r }) => r), reports: doc.reports.map(({ html, csv, ...r }) => r) })));

  on('PUT', '/api/orgs/:id/waste', withDoc(({ doc, body }) => {
    doc.inventory.waste = body;
    store.audit(doc, 'waste.updated', 'user', { industry: doc.inventory.organisation.industry });
    store.save(doc);
    return { ok: true };
  }));

  on('PUT', '/api/orgs/:id/settings', withDoc(({ doc, body }) => {
    if (body.gwp_set) { if (!GWP_SETS[body.gwp_set]) throw httpError(400, 'Unknown gwp_set'); doc.inventory.gwp_set = body.gwp_set; }
    if (body.revenue_inr !== undefined) doc.inventory.organisation.revenue_inr = body.revenue_inr;
    if (body.scope3_screening) doc.inventory.scope3_screening = body.scope3_screening;
    store.audit(doc, 'settings.updated', 'user', body);
    store.save(doc);
    return { ok: true };
  }));

  on('POST', '/api/orgs/:id/activities', withDoc(({ doc, body }) => {
    const act = { ...body, id: body.id ?? `A-${doc.inventory.activities.length + 1}` };
    const trial = { ...doc.inventory, activities: [...doc.inventory.activities, act] };
    const v = validateInventory(trial);
    const mine = v.errors.filter((e) => e.ref === act.id);
    if (mine.length) throw httpError(422, 'Activity rejected', { errors: mine });
    // Dry-run the calculation so unusable units/fuels fail now, not at report time.
    const probe = runInventory({ ...trial, waste: null, activities: [act] });
    const failed = probe.result.exclusions.find((x) => x.startsWith(`Activity ${act.id}:`));
    if (failed) throw httpError(422, 'Activity cannot be calculated', { errors: [{ code: 'CALC', message: failed }] });
    doc.inventory.activities.push(act);
    store.audit(doc, 'activity.added', 'user', { id: act.id, type: act.type, evidence: act.evidence?.id ?? null });
    store.save(doc);
    return { status: 201, body: { id: act.id, warnings: v.warnings.filter((w) => w.ref === act.id) } };
  }));

  on('POST', '/api/orgs/:id/activities/:aid/void', withDoc(({ doc, params, body }) => {
    const a = doc.inventory.activities.find((x) => x.id === params.aid);
    if (!a) throw httpError(404, 'Unknown activity');
    if (!body.reason) throw httpError(400, 'A reason is required to void an activity');
    a.voided = { reason: body.reason, at: new Date().toISOString() }; // records are never deleted
    store.audit(doc, 'activity.voided', 'user', { id: a.id, reason: body.reason });
    store.save(doc);
    return { ok: true };
  }));

  on('POST', '/api/orgs/:id/calculate', withDoc(({ doc, body }) => {
    const inv = guardCalc(() => inventoryForFy(doc.inventory, body.fy ?? doc.inventory.organisation.reporting_fy));
    const out = guardCalc(() => runInventory(inv));
    const run = { id: `run_${doc.runs.length + 1}`, at: new Date().toISOString(), fy: inv.organisation.reporting_fy, manifest: out.manifest, eligibility: out.report_eligibility, inventory: JSON.parse(JSON.stringify(inv)) };
    doc.runs.push(run);
    store.audit(doc, 'calculation.run', 'user', { run: run.id, result_hash: out.manifest.result_hash });
    store.save(doc);
    return { run_id: run.id, ...out };
  }));

  // Stateless live calculation for the UI: nothing is stored, no run is created, the audit log is untouched.
  const guardCalc = (fn) => { try { return fn(); } catch (e) { throw httpError(422, e.message); } };
  on('POST', '/api/orgs/:id/preview', withDoc(({ doc, body }) => guardCalc(() => {
    const inv = { ...doc.inventory, ...(body.waste ? { waste: body.waste } : {}) };
    return runInventory(inventoryForFy(inv, body.fy ?? doc.inventory.organisation.reporting_fy));
  })));

  on('POST', '/api/orgs/:id/scenario', withDoc(({ doc, body }) => guardCalc(() => runScenario(inventoryForFy(doc.inventory, body.fy ?? doc.inventory.organisation.reporting_fy), body.levers ?? {}))));
  on('POST', '/api/orgs/:id/recommendations', withDoc(({ doc, body }) => guardCalc(() => recommendations(inventoryForFy(doc.inventory, body.fy ?? doc.inventory.organisation.reporting_fy), body.assumptions ?? {}))));

  on('GET', '/api/orgs/:id/runs/:rid/verify', withDoc(({ doc, params }) => {
    const run = doc.runs.find((r) => r.id === params.rid);
    if (!run) throw httpError(404, 'Unknown run');
    const again = runInventory(run.inventory);
    return { run: run.id, reproducible: again.manifest.result_hash === run.manifest.result_hash, stored: run.manifest.result_hash, recomputed: again.manifest.result_hash };
  }));

  on('POST', '/api/orgs/:id/reports', withDoc(({ doc, body }) => {
    const run = doc.runs.find((r) => r.id === body.run_id);
    if (!run) throw httpError(404, 'Unknown run_id: calculate first');
    const out = runInventory(run.inventory); // regenerate from the snapshot, never from edited live data
    if (out.manifest.result_hash !== run.manifest.result_hash) throw httpError(409, 'Run is not reproducible with the current factor register: re-run the calculation and review the change');
    const status = body.status ?? 'draft';
    if (status !== 'draft' && !body.issued_by) throw httpError(400, 'issued_by (person responsible) is required for any non-draft status');
    const version = doc.reports.length + 1;
    if (body.supersedes != null) {
      if (!doc.reports.some((r) => r.version === Number(body.supersedes))) throw httpError(404, 'Report to supersede not found');
      if (!body.reason || String(body.reason).trim().length < 5) throw httpError(400, 'A reason for the correction is required');
    }
    const narrative = body.narrative?.text ? { text: String(body.narrative.text).slice(0, 2000), ai: !!body.narrative.ai } : null;
    if (narrative && hasBannedClaim(narrative.text)) throw httpError(422, 'The summary contains a verification, assurance or compliance claim this report cannot make. Remove it and try again.');
    let html;
    try {
      html = buildReportHtml({ result: out.result, manifest: out.manifest, eligibility: out.report_eligibility }, { status, version, issuedBy: body.issued_by ?? null, issuedAt: new Date().toISOString().slice(0, 10), narrative });
    } catch (e) { throw httpError(422, e.message); }
    const csv = buildReportCsv({ result: out.result });
    doc.reports.push({ version, run_id: run.id, fy: out.result.reporting_fy, name: body.name || `Supplier emissions data FY ${out.result.reporting_fy}`, total_t: out.result.totals_t.scope1_2_3_assessed_t, scope1_2_t: out.result.totals_t.scope1_2_location_t, status, issued_by: body.issued_by ?? null, supersedes: body.supersedes != null ? Number(body.supersedes) : null, narrative_ai: narrative?.ai ?? false, reason: body.reason ?? null, at: new Date().toISOString(), html_sha256: sha(html), html, csv });
    store.audit(doc, 'report.issued', body.issued_by ?? 'user', { version, status, run: run.id, html_sha256: sha(html) });
    store.save(doc);
    return { status: 201, body: { version, status, html_sha256: sha(html) } };
  }));

  on('GET', '/api/orgs/:id/reports/:ver/:fmt', withDoc(({ doc, params }) => {
    const r = doc.reports.find((x) => x.version === Number(params.ver));
    if (!r) throw httpError(404, 'Unknown report version');
    return params.fmt === 'csv' ? { raw: r.csv, type: 'text/csv; charset=utf-8' } : { raw: r.html, type: 'text/html; charset=utf-8' };
  }));

  on('GET', '/api/orgs/:id/audit', withDoc(({ doc }) => ({ chain: verifyAuditChain(doc.audit), entries: doc.audit })));

  registerApp({ on, withDoc, store, dataDir, rateLimit });
  registerAi({ on, withDoc, store, rateLimit });

  // ---------- http plumbing ----------
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; object-src 'self' blob:; frame-src 'self' blob:; frame-ancestors 'none'");
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(res, url.pathname);
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500) console.error(e);
      json(res, status, { error: status === 500 ? 'Internal error' : e.message, ...(e.extra ?? {}) });
    }
  });

  async function handleApi(req, res, url) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = req.method === 'GET' ? {} : await readJson(req, r.limit);
      const out = await r.handler({ req, params, body, token });
      if (out?.raw !== undefined) { res.writeHead(200, { 'Content-Type': out.type, ...(out.headers ?? {}) }); return res.end(out.raw); }
      if (out?.status && out?.body) return json(res, out.status, out.body);
      return json(res, 200, out);
    }
    throw httpError(404, 'Not found');
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const full = path.normalize(path.join(PUBLIC, rel));
    if (!full.startsWith(PUBLIC + path.sep) && full !== PUBLIC) throw httpError(404, 'Not found');
    try {
      const data = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream' });
      res.end(data);
    } catch { throw httpError(404, 'Not found'); }
  }

  return { server, store };
}

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const str = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw httpError(400, `${name} is required`); return v.trim(); };

async function readJson(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, 'Body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'Invalid JSON'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, host } = config;
  createApp().server.listen(port, host, () => console.log(`CARBONOVA listening on http://${host}:${port}  (AI: ${config.groqKey ? 'key found, model ' + config.groqModel : 'no GROQ_API_KEY, AI features disabled'})`));
}
