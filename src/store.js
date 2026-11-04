import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

/**
 * File-backed store for the prototype. One JSON document per organisation, written atomically.
 * The production target is PostgreSQL (see db/schema.sql); the shape here mirrors that schema.
 *
 * Each organisation document holds: profile, token_hash, inventory, audit[] (hash-chained), runs[], reports[].
 * Issued runs and reports are append-only: corrections create a new version, never edit an old one.
 */
export class Store {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  file(id) {
    if (!/^org_[a-f0-9]{16}$/.test(id)) throw httpError(404, 'Unknown organisation');
    return path.join(this.dir, `${id}.json`);
  }

  create(profile) {
    const id = `org_${randomBytes(8).toString('hex')}`;
    const token = randomBytes(24).toString('base64url');
    const doc = { id, token_hash: sha(token), inventory: { organisation: profile, activities: [], waste: null, gwp_set: 'AR6' }, audit: [], runs: [], reports: [] };
    this.audit(doc, 'org.created', 'system', { legal_name: profile.legal_name });
    this.save(doc);
    return { id, token };
  }

  load(id, token) {
    const f = this.file(id);
    if (!existsSync(f)) throw httpError(404, 'Unknown organisation');
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    const given = Buffer.from(sha(token ?? ''));
    const want = Buffer.from(doc.token_hash);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw httpError(401, 'Invalid or missing token for this organisation');
    return doc;
  }

  save(doc) {
    const f = this.file(doc.id);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2));
    renameSync(tmp, f);
  }

  /** Hash-chained, append-only audit event: each entry commits to the previous one. */
  audit(doc, action, actor, detail = {}) {
    const prev = doc.audit.at(-1)?.hash ?? 'GENESIS';
    const entry = { seq: doc.audit.length + 1, at: new Date().toISOString(), action, actor, detail, prev };
    entry.hash = sha(prev + JSON.stringify([entry.seq, entry.at, action, actor, detail]));
    doc.audit.push(entry);
  }
}

export function verifyAuditChain(audit) {
  let prev = 'GENESIS';
  for (const e of audit) {
    const h = sha(prev + JSON.stringify([e.seq, e.at, e.action, e.actor, e.detail]));
    if (e.prev !== prev || e.hash !== h) return { ok: false, broken_at: e.seq };
    prev = e.hash;
  }
  return { ok: true, entries: audit.length };
}

export const sha = (s) => createHash('sha256').update(s).digest('hex');
export function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.extra = extra;
  return e;
}
