import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { httpError, sha } from '../store.js';
import { runInventory } from '../engine/calculate.js';
import { validateInventory, fyBounds } from '../engine/validate.js';
import { inventoryForFy, availableFys, prevFy, monthKeysOfFy, sourceOf, fyOf } from '../engine/periods.js';
import { INDUSTRIES } from '../waste/industries.js';
import { WASTE_CLASSES, ROUTES } from '../waste/taxonomy.js';
import { extractDocument, detectKind, MIME_OF, DOC_TYPES, LOW_CONFIDENCE } from '../extract/index.js';
import { register } from '../engine/factors.js';
import { buildDemo } from './demo.js';

const MAX_FILE = 6_000_000;
const KIND_FUEL = { diesel: 'diesel', petrol: 'petrol', lpg: 'lpg', fuel_other: null };
const STATUSES = ['saved', 'planned', 'in_progress', 'completed', 'dismissed'];
const ROLES = ['owner', 'admin', 'preparer', 'reviewer', 'viewer'];

export function registerApp({ on, withDoc, store, dataDir, rateLimit }) {
  const docDir = (orgId) => { const d = path.join(dataDir, '..', 'docs', orgId); mkdirSync(d, { recursive: true }); return d; };
  const save = (doc, action, detail = {}, actor = 'user') => { store.audit(doc, action, actor, detail); store.save(doc); };
  const num = (v) => (v === '' || v == null ? undefined : Number(v));

  // ------------------------------------------------------------------ records
  /** Map the friendly "Add activity" form to an engine activity or a waste record. */
  function toRecord(body, existing) {
    const kind = body.kind ?? existing?.kind;
    const base = { label: String(body.label ?? existing?.label ?? '').trim() || undefined, facility_id: body.facility_id ?? existing?.facility_id, review_status: body.review_status ?? existing?.review_status ?? 'confirmed',
      data_quality: body.data_quality ?? existing?.data_quality ?? 'measured', estimation_basis: body.estimation_basis ?? existing?.estimation_basis, created_from: existing?.created_from ?? body.created_from ?? 'manual' };
    const period = { start: body.start ?? existing?.period?.start, end: body.end ?? body.start ?? existing?.period?.end };
    if (kind === 'waste') {
      const cls = body.waste_class ?? existing?.waste_class;
      if (!WASTE_CLASSES[cls]) throw httpError(422, 'Choose a waste type', { errors: [{ code: 'WASTE_CLASS', message: 'Unknown waste type' }] });
      const route = body.route ?? existing?.route ?? 'recycling';
      if (!ROUTES[route]) throw httpError(422, 'Unknown treatment route');
      return { waste: true, rec: { ...base, kind, waste_class: cls, tonnes: num(body.tonnes ?? body.quantity) ?? existing?.tonnes, route, location: body.location ?? existing?.location ?? 'offsite', facility: body.facility ?? existing?.facility ?? null, period } };
    }
    const a = { ...base, kind, period };
    if (kind === 'electricity') Object.assign(a, { type: 'electricity', meter_id: body.meter_id ?? existing?.meter_id ?? 'MAIN', grid_import_kwh: num(body.quantity ?? body.grid_import_kwh) ?? existing?.grid_import_kwh, solar_generated_kwh: num(body.solar_generated_kwh) ?? existing?.solar_generated_kwh,
      solar_self_consumed_kwh: num(body.solar_self_consumed_kwh) ?? existing?.solar_self_consumed_kwh, solar_exported_kwh: num(body.solar_exported_kwh) ?? existing?.solar_exported_kwh, contractual_re_kwh: num(body.contractual_re_kwh) ?? existing?.contractual_re_kwh, source: body.source ?? existing?.source ?? 'grid' });
    else if (kind === 'refrigerant') Object.assign(a, { type: 'refrigerant', refrigerant: body.refrigerant ?? existing?.refrigerant ?? 'R-410A', quantity: num(body.quantity) ?? existing?.quantity, unit: 'kg' });
    else if (kind in KIND_FUEL || kind === 'transport') {
      const fuel = kind === 'transport' ? (body.fuel ?? existing?.fuel ?? 'diesel') : (KIND_FUEL[kind] ?? body.fuel ?? existing?.fuel);
      Object.assign(a, { type: 'fuel', fuel, use: body.use ?? existing?.use ?? (kind === 'transport' ? 'mobile' : 'stationary'), ownership: kind === 'transport' ? 'third_party' : 'owned',
        scope3_category: kind === 'transport' ? Number(body.scope3_category ?? existing?.scope3_category ?? 4) : undefined, quantity: num(body.quantity) ?? existing?.quantity, unit: body.unit ?? existing?.unit ?? 'L', asset: body.asset ?? existing?.asset, ncv_override_gj_per_t: num(body.ncv_override_gj_per_t) ?? existing?.ncv_override_gj_per_t });
    } else throw httpError(422, `Unsupported activity type "${kind}"`);
    if (body.evidence) a.evidence = body.evidence; else if (existing?.evidence) a.evidence = existing.evidence;
    for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
    return { waste: false, rec: a };
  }

  /** Validate a candidate against the rest of the inventory and dry-run the calculation, so bad data is rejected now. */
  function checkRecord(doc, built, existingId) {
    if (built.waste) {
      const r = built.rec;
      const errs = [];
      if (!(r.tonnes >= 0) || !Number.isFinite(r.tonnes)) errs.push({ code: 'QUANTITY', message: 'Enter the weight in tonnes (0 or more).' });
      if (!r.period.start || Number.isNaN(Date.parse(r.period.start))) errs.push({ code: 'PERIOD', message: 'Enter the date or period.' });
      if (!r.label) errs.push({ code: 'LABEL', message: 'Give the waste a name.' });
      if (WASTE_CLASSES[r.waste_class].hazardous && !ROUTES[r.route].hazardous_ok) errs.push({ code: 'HAZ_ROUTE_NOT_PERMITTED', message: `${WASTE_CLASSES[r.waste_class].label} is hazardous and cannot go to "${ROUTES[r.route].label}". Use an authorised recycler, TSDF, incinerator or co-processor.` });
      if (ROUTES[r.route].prohibited) errs.push({ code: 'PROHIBITED_ROUTE', message: 'Open burning is not a permitted route.' });
      if (errs.length) throw httpError(422, 'Record rejected', { errors: errs });
      return [];
    }
    const act = { ...built.rec, id: existingId ?? built.rec.id };
    const others = doc.inventory.activities.filter((x) => x.id !== existingId);
    const trial = { ...doc.inventory, activities: [...others, act] };
    const v = validateInventory(trial);
    const mine = v.errors.filter((e) => e.ref === act.id);
    if (mine.length) throw httpError(422, 'Record rejected', { errors: mine });
    const { start, end } = fyBounds(doc.inventory.organisation.reporting_fy);
    void start; void end;
    const probe = runInventory({ ...trial, reporting_fy: undefined, organisation: { ...trial.organisation, reporting_fy: fyOf(act.period.start) }, waste: null, activities: [act] });
    const failed = probe.result.exclusions.find((x) => x.startsWith(`Activity ${act.id}:`) && !/awaiting review/.test(x));
    if (failed) throw httpError(422, 'This record cannot be calculated', { errors: [{ code: 'CALC', message: failed.replace(/^Activity [^:]+: /, '') }] });
    return v.warnings.filter((w) => w.ref === act.id);
  }

  const nextId = (doc, prefix, list) => { let n = list.length + 1; while (list.some((x) => x.id === `${prefix}-${n}`)) n++; return `${prefix}-${n}`; };

  function listRecords(doc) {
    const inv = doc.inventory;
    const rows = [];
    const NAME = { electricity: 'Electricity', diesel: 'Diesel', petrol: 'Petrol', lpg: 'LPG', refrigerant: 'Refrigerant' };
    for (const a of inv.activities) {
      let kind = a.kind;
      if (!kind) kind = a.type === 'electricity' ? 'electricity' : a.type === 'refrigerant' ? 'refrigerant' : a.type === 'fuel' ? (a.ownership === 'third_party' ? 'transport' : ['diesel', 'petrol', 'lpg'].includes(a.fuel) ? a.fuel : 'fuel_other') : 'other';
      const qty = a.type === 'electricity' ? a.grid_import_kwh : a.quantity;
      const unit = a.type === 'electricity' ? 'kWh' : a.unit ?? 'kg';
      const srcDoc = doc.documents?.find((d) => d.activity_ids?.includes(a.id));
      rows.push({ id: a.id, kind, name: a.label ?? `${NAME[kind] ?? (a.fuel ?? kind)} ${a.period.start.slice(0, 7)}`, category: kind === 'transport' ? 'Transport (hired)' : NAME[kind] ?? String(a.fuel ?? kind).replace('_', ' '),
        scope: a.type === 'electricity' ? 2 : a.ownership === 'third_party' ? 3 : 1, scope3_category: a.scope3_category ?? null, quantity: qty, unit, period: a.period, facility_id: a.facility_id,
        source: srcDoc ? `Document: ${srcDoc.name}` : a.evidence?.id ? `Evidence: ${a.evidence.id}` : 'Manual entry', document_id: srcDoc?.id ?? null, review_status: a.review_status ?? 'confirmed', data_quality: a.data_quality ?? 'measured', voided: a.voided ?? null, raw: a });
    }
    for (const g of inv.waste?.general_waste ?? []) {
      rows.push({ id: g.id, kind: 'waste', name: g.label ?? 'Waste', category: `Waste: ${WASTE_CLASSES[g.waste_class]?.label ?? g.waste_class}`, scope: g.location === 'onsite' ? 1 : 3, scope3_category: g.location === 'onsite' ? null : 5, quantity: g.tonnes, unit: 't',
        period: g.period ?? { start: `${fyBounds(inv.organisation.reporting_fy).start}`, end: fyBounds(inv.organisation.reporting_fy).end }, facility_id: g.facility_id ?? null, source: 'Manual entry', document_id: null, review_status: g.review_status ?? 'confirmed', data_quality: g.data_quality ?? 'measured', voided: g.voided ?? null, raw: g });
    }
    const live = rows.filter((r) => !r.voided);
    for (const r of live) {
      r.duplicate_of = live.filter((o) => o.id !== r.id && o.kind === r.kind && o.facility_id === r.facility_id && o.period.start === r.period.start && o.period.end === r.period.end && o.quantity === r.quantity).map((o) => o.id);
      const ev = r.raw.evidence?.hash;
      if (ev) r.duplicate_of.push(...live.filter((o) => o.id !== r.id && o.raw.evidence?.hash === ev).map((o) => o.id));
      r.duplicate_of = [...new Set(r.duplicate_of)];
    }
    return rows.sort((a, b) => b.period.start.localeCompare(a.period.start));
  }

  on('GET', '/api/orgs/:id/records', withDoc(({ doc }) => ({ records: listRecords(doc) })));

  on('POST', '/api/orgs/:id/records', withDoc(({ doc, body }) => {
    const built = toRecord(body);
    if (built.waste) {
      const list = (doc.inventory.waste ??= { stages: {}, general_waste: [], disposal_site: {} }).general_waste ??= [];
      built.rec.id = nextId(doc, 'W', list); built.rec.stream_id = built.rec.id;
      const warnings = checkRecord(doc, built);
      list.push({ ...built.rec, id: built.rec.id });
      save(doc, 'record.added', { id: built.rec.id, kind: 'waste' });
      return { status: 201, body: { id: built.rec.id, warnings } };
    }
    const id = nextId(doc, 'A', doc.inventory.activities);
    built.rec.id = id;
    const warnings = checkRecord(doc, built, id);
    doc.inventory.activities.push({ ...built.rec, id });
    save(doc, 'record.added', { id, kind: built.rec.kind, evidence: built.rec.evidence?.id ?? null });
    return { status: 201, body: { id, warnings } };
  }));

  on('PUT', '/api/orgs/:id/records/:rid', withDoc(({ doc, params, body }) => {
    const wi = doc.inventory.waste?.general_waste?.findIndex((g) => g.id === params.rid) ?? -1;
    if (wi >= 0) {
      const old = doc.inventory.waste.general_waste[wi];
      const built = toRecord({ ...body, kind: 'waste' }, old);
      checkRecord(doc, built);
      doc.inventory.waste.general_waste[wi] = { ...old, ...built.rec, id: old.id };
      save(doc, 'record.edited', { id: old.id, kind: 'waste' });
      return { ok: true };
    }
    const i = doc.inventory.activities.findIndex((a) => a.id === params.rid);
    if (i < 0) throw httpError(404, 'Unknown record');
    const old = doc.inventory.activities[i];
    if (old.voided) throw httpError(409, 'A deleted record cannot be edited');
    const kind = old.kind ?? listRecords(doc).find((r) => r.id === old.id).kind;
    const built = toRecord({ ...body, kind }, { ...old, kind });
    const warnings = checkRecord(doc, built, old.id);
    const changes = Object.keys(built.rec).filter((k) => JSON.stringify(built.rec[k]) !== JSON.stringify(old[k]));
    doc.inventory.activities[i] = { ...built.rec, id: old.id };
    save(doc, 'record.edited', { id: old.id, changed: changes });
    return { ok: true, warnings };
  }));

  on('POST', '/api/orgs/:id/records/:rid/void', withDoc(({ doc, params, body }) => {
    if (!body.reason) throw httpError(400, 'A reason is required: deleted records stay in the audit trail');
    const rec = doc.inventory.activities.find((a) => a.id === params.rid) ?? doc.inventory.waste?.general_waste?.find((g) => g.id === params.rid);
    if (!rec) throw httpError(404, 'Unknown record');
    rec.voided = { reason: body.reason, at: new Date().toISOString() };
    save(doc, 'record.deleted', { id: rec.id, reason: body.reason });
    return { ok: true };
  }));

  on('POST', '/api/orgs/:id/records/:rid/review', withDoc(({ doc, params, body }) => {
    if (!['confirmed', 'needs_review'].includes(body.status)) throw httpError(400, 'status must be confirmed or needs_review');
    const rec = doc.inventory.activities.find((a) => a.id === params.rid) ?? doc.inventory.waste?.general_waste?.find((g) => g.id === params.rid);
    if (!rec) throw httpError(404, 'Unknown record');
    rec.review_status = body.status;
    save(doc, 'record.review', { id: rec.id, status: body.status });
    return { ok: true };
  }));

  // ------------------------------------------------------------------ documents
  const metaOf = ({ file_path, ...d }) => d;
  on('GET', '/api/orgs/:id/documents', withDoc(({ doc }) => ({ documents: (doc.documents ?? []).map(metaOf).reverse() })));

  on('POST', '/api/orgs/:id/documents', withDoc(({ doc, body }) => {
    if (!DOC_TYPES[body.doc_type]) throw httpError(400, `doc_type must be one of ${Object.keys(DOC_TYPES).join(', ')}`);
    const name = String(body.name ?? '').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
    if (!name || typeof body.data !== 'string') throw httpError(400, 'name and base64 data are required');
    const buf = Buffer.from(body.data, 'base64');
    if (!buf.length || buf.length > MAX_FILE) throw httpError(413, `File must be between 1 byte and ${MAX_FILE / 1e6} MB`);
    const kind = detectKind(buf, name);
    if (!kind) throw httpError(415, 'Unsupported file. Upload a PDF, PNG, JPG or CSV (the file content must match its type).');
    if (body.doc_type === 'csv' && kind !== 'csv') throw httpError(415, 'A CSV document must be a .csv file');
    if (kind === 'csv' && body.doc_type !== 'csv') throw httpError(415, 'CSV files must be uploaded as the "CSV file" type');
    const hash = createHash('sha256').update(buf).digest('hex');
    doc.documents ??= [];
    const dup = doc.documents.find((d) => d.sha256 === hash && d.status !== 'rejected');
    if (dup) throw httpError(409, `This file was already uploaded as "${dup.name}" (${dup.status.replace('_', ' ')}). Importing it again would double count.`, { existing: metaOf(dup) });
    const ex = extractDocument(buf, { docType: body.doc_type, name });
    const id = nextId(doc, 'D', doc.documents);
    const file = path.join(docDir(doc.id), `${hash}.bin`);
    writeFileSync(file, buf);
    const d = { id, name, doc_type: body.doc_type, mime: MIME_OF[kind], size: buf.length, sha256: hash, uploaded_at: new Date().toISOString(), status: 'needs_review', extraction: { service: ex.service, fields: ex.fields, rows: ex.rows, notes: ex.notes, has_text: !!ex.text, text: ex.text?.slice(0, 4000) ?? '' }, activity_ids: [], file_path: file };
    doc.documents.push(d);
    save(doc, 'document.uploaded', { id, name, doc_type: body.doc_type, sha256: hash });
    return { status: 201, body: { document: metaOf(d) } };
  }, { limit: 9_000_000 }));

  on('GET', '/api/orgs/:id/documents/:did/file', withDoc(({ doc, params }) => {
    const d = doc.documents?.find((x) => x.id === params.did);
    if (!d || !d.file_path || !existsSync(d.file_path)) throw httpError(404, 'Original file not stored for this document (demo record)');
    return { raw: readFileSync(d.file_path), type: d.mime, headers: { 'Content-Disposition': 'inline' } };
  }));

  on('POST', '/api/orgs/:id/documents/:did/reject', withDoc(({ doc, params, body }) => {
    const d = doc.documents?.find((x) => x.id === params.did);
    if (!d) throw httpError(404, 'Unknown document');
    d.status = 'rejected'; d.reject_reason = body.reason ?? 'Rejected in review';
    save(doc, 'document.rejected', { id: d.id, reason: d.reject_reason });
    return { ok: true };
  }));

  /** Confirm reviewed values: creates the activity record(s) and links them to the document. */
  on('POST', '/api/orgs/:id/documents/:did/confirm', withDoc(({ doc, params, body }) => {
    const d = doc.documents?.find((x) => x.id === params.did);
    if (!d) throw httpError(404, 'Unknown document');
    if (d.status === 'confirmed') throw httpError(409, 'This document is already confirmed');
    const evidence = { id: d.name, hash: d.sha256, user_confirmed: true };
    const created = [];
    const warnings = [];
    const addOne = (payload) => {
      const built = toRecord({ ...payload, evidence, created_from: `document:${d.id}` });
      if (built.waste) throw httpError(422, 'Waste documents are entered as waste records; use Activity Records');
      const id = nextId(doc, 'A', doc.inventory.activities);
      built.rec.id = id;
      warnings.push(...checkRecord(doc, built, id));
      doc.inventory.activities.push({ ...built.rec, id });
      created.push(id);
    };
    if (d.doc_type === 'csv') {
      const picks = new Set(body.rows ?? d.extraction.rows.filter((r) => !r.errors.length).map((r) => r.line));
      for (const r of d.extraction.rows.filter((x) => picks.has(x.line))) {
        if (r.errors.length) throw httpError(422, `Row ${r.line} has errors: ${r.errors.join('; ')}`);
        addOne({ kind: r.type === 'electricity' ? 'electricity' : (['diesel', 'petrol', 'lpg'].includes(r.fuel) ? r.fuel : 'fuel_other'), fuel: r.fuel, start: r.start, end: r.end, quantity: r.quantity, unit: r.unit, facility_id: body.facility_id, meter_id: r.meter, use: r.use || undefined, label: `${r.type} ${r.start} (CSV line ${r.line})` });
      }
    } else {
      const v = body.values ?? {};
      const kind = body.kind;
      if (!kind) throw httpError(400, 'Choose what this document records (electricity, diesel, ...)');
      const minConf = Math.min(...d.extraction.fields.filter((f) => f.value !== '' && !(f.key in (body.corrections ?? {}))).map((f) => f.confidence), 1);
      evidence.extraction_confidence = d.extraction.fields.length ? minConf : null;
      addOne({ kind, facility_id: body.facility_id, start: v.period_start, end: v.period_end || v.period_start, quantity: v.quantity, unit: v.unit, fuel: v.fuel, meter_id: v.meter_id, label: body.label || `${DOC_TYPES[d.doc_type]} ${v.period_start ?? ''}`.trim(), data_quality: 'measured' });
    }
    d.status = 'confirmed'; d.activity_ids = created; d.reviewed_at = new Date().toISOString();
    d.review = { values: body.values ?? null, corrections: body.corrections ?? {}, kind: body.kind ?? 'csv' };
    save(doc, 'document.confirmed', { id: d.id, created, corrections: Object.keys(body.corrections ?? {}) });
    return { ok: true, created, warnings };
  }));

  // ------------------------------------------------------------------ summary (dashboard + footprint)
  function computeSummary(doc, body) {
    const inv = doc.inventory;
    const fys = availableFys(inv);
    const fy = fys.includes(body.fy) ? body.fy : inv.organisation.reporting_fy;
    const run = (f) => { try { return runInventory(inventoryForFy(inv, f)); } catch { return null; } };
    const cur = run(fy);
    const pFy = prevFy(fy);
    const prev = fys.includes(pFy) ? run(pFy) : null;
    const months = monthKeysOfFy(fy);
    const series = (out, ms) => ms.map((k) => { const m = { key: k, s1: 0, s2: 0, s3: 0, total: 0 }; for (const l of out?.result.lines ?? []) if (l.period.start.slice(0, 7) === k && l.type !== 'waste' && !String(l.activity_id).startsWith('process:')) { m[`s${l.scope}`] += l.co2eKg / 1000; m.total += l.co2eKg / 1000; } return m; });
    const curM = series(cur, months);
    const prevM = series(prev, monthKeysOfFy(pFy));
    const hasData = (m) => m.total > 0;
    const lastIdx = curM.reduce((acc, m, i) => (hasData(m) ? i : acc), -1);
    const dated = (out) => (out?.result.lines ?? []).filter((l) => l.type !== 'waste' && !String(l.activity_id).startsWith('process:')).reduce((s, l) => s + l.co2eKg / 1000, 0);
    const toDateCur = curM.slice(0, lastIdx + 1).reduce((s, m) => s + m.total, 0);
    const toDatePrev = prevM.slice(0, lastIdx + 1).reduce((s, m) => s + m.total, 0);
    const bySource = {};
    for (const l of cur?.result.lines ?? []) { const k = sourceOf(l); bySource[k] = (bySource[k] ?? 0) + l.co2eKg / 1000; }

    // completeness: each recurring stream should have a confirmed record in every elapsed month
    const { start: fyStart } = fyBounds(fy);
    const today = new Date().toISOString().slice(0, 7);
    const elapsed = months.filter((k) => k < today && k >= fyStart.slice(0, 7)); // the current month is not due yet
    const acts = inv.activities.filter((a) => !a.voided);
    const label = (a) => (a.type === 'electricity' ? 'Electricity' : a.fuel === 'lpg' ? 'LPG' : a.fuel[0].toUpperCase() + a.fuel.slice(1));
    const recurring = (a) => a.type === 'electricity' || (a.type === 'fuel' && a.ownership !== 'third_party' && ['diesel', 'petrol', 'lpg'].includes(a.fuel));
    const streamKeys = new Set(acts.filter(recurring).map(label));
    const have = {}; const missing = {};
    let expected = 0; let got = 0;
    for (const s of streamKeys) {
      missing[s] = [];
      for (const k of elapsed) {
        expected++;
        const ok = acts.some((a) => a.period.start.slice(0, 7) === k && (a.review_status ?? 'confirmed') === 'confirmed' && recurring(a) && label(a) === s);
        if (ok) { got++; (have[s] ??= []).push(k); } else missing[s].push(k);
      }
    }
    const pendingDocs = (doc.documents ?? []).filter((d) => d.status === 'needs_review').length;
    const pendingRecords = acts.filter((a) => (a.review_status ?? 'confirmed') !== 'confirmed').length;
    const waste = cur?.result.waste;

    return {
      fy, fys, previous_fy: prev ? pFy : null, current: cur, months: curM, previous_months: prevM,
      comparison: prev ? { to_month: months[Math.max(lastIdx, 0)], current_t: toDateCur, previous_t: toDatePrev, change_pct: toDatePrev ? ((toDateCur - toDatePrev) / toDatePrev) * 100 : null, full_prev_year_t: dated(prev) } : null,
      annual_items_t: cur ? cur.result.totals_t.scope1_2_3_assessed_t - toDateCur : 0,
      by_source: Object.entries(bySource).map(([k, v]) => ({ key: k, t: v })).sort((a, b) => b.t - a.t),
      completeness: { expected, have: got, pct: expected ? got / expected : null, missing, pending_documents: pendingDocs, pending_records: pendingRecords },
      waste_brief: waste ? { per_t: waste.chain.summary.waste_per_t_final_product, hazardous_t: waste.chain.summary.hazardous_t, recovery_rate: waste.brsr.recovery_rate, streams_to_measure: waste.chain.summary.streams_requiring_measurement } : null,
    };
  }
  on('POST', '/api/orgs/:id/summary', withDoc(({ doc, body }) => computeSummary(doc, body)));

  // ------------------------------------------------------------------ notifications (derived) and activity feed
  function notifications(doc, summary) {
    const n = [];
    const docs = (doc.documents ?? []).filter((d) => d.status === 'needs_review');
    if (docs.length) n.push({ id: `docs:${docs.map((d) => d.id).join(',')}`, level: 'warn', title: `${docs.length} document${docs.length > 1 ? 's' : ''} waiting for review`, body: docs.map((d) => d.name).join(', '), link: 'documents' });
    for (const [stream, months] of Object.entries(summary.completeness.missing)) if (months.length) n.push({ id: `missing:${stream}:${months.join(',')}`, level: 'warn', title: `Missing ${stream.toLowerCase()} record${months.length > 1 ? 's' : ''}`, body: months.join(', '), link: 'records' });
    if (summary.completeness.pending_records) n.push({ id: `pending:${summary.completeness.pending_records}`, level: 'warn', title: `${summary.completeness.pending_records} record(s) not yet approved`, body: 'Unapproved records are left out of the totals.', link: 'records' });
    const prov = summary.current?.report_eligibility.provisional_factors.length;
    if (prov) n.push({ id: `prov:${prov}`, level: 'info', title: `${prov} emission factor(s) are provisional`, body: 'Reports can be draft or self-declared only until factors are validated.', link: 'factors' });
    if (summary.waste_brief?.streams_to_measure) n.push({ id: `measure:${summary.waste_brief.streams_to_measure}`, level: 'info', title: `${summary.waste_brief.streams_to_measure} waste stream(s) need a measured quantity`, body: 'They are shown as not assessed, never zero.', link: 'footprint' });
    const read = new Set(doc.notifications_read ?? []);
    return n.map((x) => ({ ...x, read: read.has(x.id) }));
  }
  on('GET', '/api/orgs/:id/notifications', withDoc(({ doc }) => ({ notifications: notifications(doc, computeSummary(doc, {})) })));
  on('POST', '/api/orgs/:id/notifications/read', withDoc(({ doc, body }) => {
    doc.notifications_read = [...new Set([...(doc.notifications_read ?? []), ...(body.ids ?? [])])];
    store.save(doc);
    return { ok: true };
  }));

  const FEED = { 'record.added': 'Added a record', 'record.edited': 'Updated a record', 'record.deleted': 'Deleted a record', 'document.uploaded': 'Uploaded a document', 'document.confirmed': 'Confirmed extracted values', 'document.rejected': 'Rejected a document',
    'calculation.run': 'Ran a calculation', 'report.issued': 'Generated a report', 'org.created': 'Created the workspace', 'action.updated': 'Updated a reduction action', 'profile.updated': 'Updated the business profile', 'record.review': 'Reviewed a record' };
  on('GET', '/api/orgs/:id/feed', withDoc(({ doc }) => ({ feed: doc.audit.filter((e) => FEED[e.action]).slice(-12).reverse().map((e) => ({ seq: e.seq, at: e.at, text: FEED[e.action], detail: e.detail?.id ?? e.detail?.name ?? e.detail?.version ?? '', action: e.action })) })));

  // ------------------------------------------------------------------ reduction actions
  on('GET', '/api/orgs/:id/actions', withDoc(({ doc }) => ({ actions: doc.actions ?? [] })));
  on('PUT', '/api/orgs/:id/actions/:rec', withDoc(({ doc, params, body }) => {
    if (!STATUSES.includes(body.status)) throw httpError(400, `status must be one of ${STATUSES.join(', ')}`);
    doc.actions ??= [];
    let a = doc.actions.find((x) => x.rec_id === params.rec);
    const now = new Date().toISOString();
    if (!a) { a = { rec_id: params.rec, title: String(body.title ?? params.rec).slice(0, 160), saved_at: now, history: [] }; doc.actions.push(a); }
    a.history.push({ at: now, from: a.status ?? null, to: body.status });
    Object.assign(a, { status: body.status, notes: body.notes ?? a.notes ?? '', est_tco2e: body.est_tco2e ?? a.est_tco2e ?? null, est_saving_inr: body.est_saving_inr ?? a.est_saving_inr ?? null, baseline_fy: body.baseline_fy ?? a.baseline_fy ?? doc.inventory.organisation.reporting_fy, updated_at: now });
    save(doc, 'action.updated', { id: a.rec_id, status: a.status });
    return { action: a };
  }));

  // ------------------------------------------------------------------ profile, settings, team, onboarding
  on('PUT', '/api/orgs/:id/profile', withDoc(({ doc, body }) => {
    const o = doc.inventory.organisation;
    const next = { ...o };
    for (const k of ['legal_name', 'business_type', 'state', 'location', 'consolidation_approach', 'reporting_fy', 'revenue_inr', 'contact', 'exclusions', 'reporting_prefs']) if (body[k] !== undefined) next[k] = body[k];
    if (body.industry && body.industry !== o.industry) {
      if (!INDUSTRIES[body.industry]) throw httpError(400, 'Unknown industry');
      next.industry = body.industry;
      doc.inventory.waste = { ...(doc.inventory.waste ?? {}), stages: {}, final_product_t: undefined };
    }
    if (body.facilities) {
      const ids = new Set(body.facilities.map((f) => f.id));
      const used = doc.inventory.activities.filter((a) => !a.voided && !ids.has(a.facility_id));
      if (used.length) throw httpError(422, `Facility ${[...new Set(used.map((a) => a.facility_id))].join(', ')} still has records. Delete or move them first.`);
      next.facilities = body.facilities.map((f) => ({ id: String(f.id), name: String(f.name), state: f.state ?? '', type: f.type ?? '' }));
    }
    const v = validateInventory({ organisation: next, activities: [] });
    const blocking = v.errors.filter((e) => e.code.startsWith('BOUNDARY') || e.code === 'REPORTING_PERIOD');
    if (blocking.length) throw httpError(422, 'Invalid business profile', { errors: blocking });
    doc.inventory.organisation = next;
    save(doc, 'profile.updated', { fields: Object.keys(body) });
    return { ok: true, organisation: next };
  }));

  on('GET', '/api/orgs/:id/app', withDoc(({ doc }) => ({
    organisation: doc.inventory.organisation, onboarding: doc.onboarding ?? { step: 1, done: false }, prefs: doc.prefs ?? {}, team: doc.team ?? [], gwp_set: doc.inventory.gwp_set,
    documents_pending: (doc.documents ?? []).filter((d) => d.status === 'needs_review').length, demo: !!doc.demo,
  })));
  on('PUT', '/api/orgs/:id/onboarding', withDoc(({ doc, body }) => { doc.onboarding = { step: Math.min(Math.max(Number(body.step) || 1, 1), 8), done: !!body.done }; store.save(doc); return doc.onboarding; }));
  on('PUT', '/api/orgs/:id/prefs', withDoc(({ doc, body }) => {
    const keep = ['user', 'notifications', 'retention_days', 'security', 'ai_enabled'];
    doc.prefs = { ...(doc.prefs ?? {}), ...Object.fromEntries(keep.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) };
    if (doc.prefs.retention_days != null && ![365, 730, 1825, 2555].includes(Number(doc.prefs.retention_days))) throw httpError(400, 'retention_days must be 365, 730, 1825 or 2555');
    save(doc, 'settings.updated', { keys: Object.keys(body) });
    return { prefs: doc.prefs };
  }));
  on('POST', '/api/orgs/:id/team', withDoc(({ doc, body }) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? '')) throw httpError(400, 'Enter a valid email address');
    if (!ROLES.includes(body.role)) throw httpError(400, `role must be one of ${ROLES.join(', ')}`);
    doc.team ??= [];
    if (doc.team.some((m) => m.email.toLowerCase() === body.email.toLowerCase())) throw httpError(409, 'This person is already on the team');
    const m = { id: nextId(doc, 'U', doc.team), name: String(body.name ?? '').slice(0, 80), email: body.email, role: body.role, added_at: new Date().toISOString() };
    doc.team.push(m); save(doc, 'team.added', { email: m.email, role: m.role });
    return { status: 201, body: { member: m } };
  }));
  on('POST', '/api/orgs/:id/team/:uid/role', withDoc(({ doc, params, body }) => {
    const m = doc.team?.find((x) => x.id === params.uid);
    if (!m) throw httpError(404, 'Unknown team member');
    if (!ROLES.includes(body.role)) throw httpError(400, 'Unknown role');
    m.role = body.role; save(doc, 'team.role', { id: m.id, role: m.role });
    return { member: m };
  }));
  on('POST', '/api/orgs/:id/team/:uid/remove', withDoc(({ doc, params }) => {
    const i = doc.team?.findIndex((x) => x.id === params.uid) ?? -1;
    if (i < 0) throw httpError(404, 'Unknown team member');
    const [m] = doc.team.splice(i, 1); save(doc, 'team.removed', { email: m.email });
    return { ok: true };
  }));

  // ------------------------------------------------------------------ public
  on('GET', '/api/factors/:id', ({ params }) => {
    const f = register().byId.get(params.id);
    if (!f) throw httpError(404, 'Unknown factor');
    return f;
  }, { auth: false });
  on('GET', '/api/factors', () => ({ version: register().version, hash: register().hash, factors: register().factors }), { auth: false });

  on('POST', '/api/demo', ({ req }) => {
    rateLimit(req, 6);
    const out = buildDemo({ store, docDir, sha });
    return { status: 201, body: out };
  }, { auth: false });
}
