import { toast } from './dom.js';

export const S = { catalog: null, creds: null, org: null, industry: null, out: null, prev: null, waste: { stages: {}, general_waste: [], disposal_site: {} }, dirty: false };
export const bus = new EventTarget();

export async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(S.creds ? { Authorization: `Bearer ${S.creds.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.errors ? ': ' + data.errors.map((e) => e.message).join(' ') : '';
    throw Object.assign(new Error((data.error ?? `HTTP ${res.status}`) + detail), { status: res.status });
  }
  return data;
}

/** Wrap an event handler so failures surface as a toast instead of an unhandled rejection. */
export const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'err'); } };

export function saveCreds() { try { localStorage.setItem('carbonova', JSON.stringify(S.creds)); } catch { /* private mode: session only */ } }
export function loadCreds() { try { return JSON.parse(localStorage.getItem('carbonova')); } catch { return null; } }
export function forget() { S.creds = null; S.org = null; S.out = null; try { localStorage.removeItem('carbonova'); } catch { /* ignore */ } }

export async function loadOrg() {
  S.org = await api('GET', `/api/orgs/${S.creds.id}`);
  S.industry = await api('GET', `/api/industries/${S.org.inventory.organisation.industry}`);
  S.waste = S.org.inventory.waste ?? { stages: {}, general_waste: [], disposal_site: {} };
  S.waste.stages ??= {}; S.waste.general_waste ??= []; S.waste.disposal_site ??= {};
  S.dirty = false;
}

let seq = 0;
/** Live, stateless calculation (nothing stored). Ignores out-of-order responses. */
export async function recompute({ useDraft = true } = {}) {
  const mine = ++seq;
  const out = await api('POST', `/api/orgs/${S.creds.id}/preview`, useDraft ? { waste: S.waste } : {});
  if (mine !== seq) return S.out;
  S.prev = S.out;
  S.out = out;
  bus.dispatchEvent(new CustomEvent('out'));
  return out;
}

export const poorRoutes = new Set(['landfill_managed', 'landfill_unmanaged_deep', 'landfill_unmanaged_shallow', 'open_burning', 'other_disposal']);
