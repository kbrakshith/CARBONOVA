import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(here, '..', 'data', 'factors.json');
const LOCAL = path.join(here, '..', '..', 'data', 'factors.local.json');

const REQUIRED = ['id', 'kind', 'activity', 'geography', 'unit', 'gas_basis', 'source', 'valid_from', 'status'];
const STATUSES = ['provisional', 'validated', 'retired'];
const GAS_BASES = ['CO2', 'individual_gas', 'CO2e'];

/** Throws if a factor record lacks provenance the audit report requires. */
export function assertFactorRecord(f) {
  for (const k of REQUIRED) {
    if (f[k] === undefined || f[k] === null || f[k] === '') throw new Error(`Factor ${f.id ?? '?'} missing "${k}"`);
  }
  if (!STATUSES.includes(f.status)) throw new Error(`Factor ${f.id}: bad status ${f.status}`);
  if (!GAS_BASES.includes(f.gas_basis)) throw new Error(`Factor ${f.id}: bad gas_basis ${f.gas_basis}`);
  if (!f.source.document || !f.source.table) throw new Error(`Factor ${f.id}: source needs document and table`);
  if (f.status === 'validated' && (!f.reviewer || !f.reviewed_on)) {
    throw new Error(`Factor ${f.id}: validated factors need reviewer and reviewed_on`);
  }
  const hasValues = f.values || f.ef_kg_per_tj;
  if (!hasValues) throw new Error(`Factor ${f.id}: no values`);
}

export function loadRegister({ includeLocal = true } = {}) {
  const base = JSON.parse(readFileSync(BASE, 'utf8'));
  const byId = new Map(base.factors.map((f) => [f.id, f]));
  if (includeLocal && existsSync(LOCAL)) {
    const local = JSON.parse(readFileSync(LOCAL, 'utf8'));
    for (const f of local.factors ?? []) byId.set(f.id, f); // local file overrides by id
  }
  const factors = [...byId.values()];
  factors.forEach(assertFactorRecord);
  const hash = createHash('sha256').update(JSON.stringify(factors)).digest('hex');
  return { version: base.register_version, factors, byId, hash };
}

let cached;
export function register() {
  cached ??= loadRegister();
  return cached;
}
export function resetRegisterCache() { cached = undefined; }

export function getFactor(id) {
  const f = register().byId.get(id);
  if (!f) throw new Error(`Unknown factor id "${id}"`);
  if (f.status === 'retired') throw new Error(`Factor ${id} is retired`);
  return f;
}

export function findFuelFactor(fuel, use) {
  const f = register().factors.find((x) => x.kind === 'fuel' && x.fuel === fuel && x.use === use && x.status !== 'retired');
  if (!f) throw new Error(`No factor for fuel "${fuel}" (${use})`);
  return f;
}

export function findGridFactor(periodEnd) {
  const all = register().factors.filter((x) => x.kind === 'grid_electricity' && x.status !== 'retired');
  if (!all.length) throw new Error('No grid electricity factor in register');
  // Prefer a factor whose validity window covers the period; otherwise the latest and let the caller warn.
  const covering = all.filter((f) => periodCovers(f, periodEnd));
  const pool = covering.length ? covering : all;
  return pool.sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
}

export function periodCovers(factor, isoDate) {
  if (!isoDate) return true;
  if (factor.valid_from && isoDate < factor.valid_from) return false;
  if (factor.valid_to && isoDate > factor.valid_to) return false;
  return true;
}

export function listFuels() {
  return [...new Set(register().factors.filter((f) => f.kind === 'fuel').map((f) => f.fuel))];
}
