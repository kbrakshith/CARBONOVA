// Workspace-level data loading shared by the shell and every page.
import { S, api, bus, loadOrg } from './state.js';

S.fy = null; S.app = null; S.summary = null; S.docs = []; S.unread = 0;

export const orgUrl = (p = '') => `/api/orgs/${S.creds.id}${p}`;

export async function loadApp() {
  S.app = await api('GET', orgUrl('/app'));
  S.ai = await api('GET', '/api/ai/status').catch(() => ({ configured: false }));
}
/** True only when the server has a key AND this workspace has switched AI on. */
export const aiReady = () => !!(S.ai?.configured && S.app?.prefs?.ai_enabled);
export async function loadSummary(fy = S.fy) {
  S.summary = await api('POST', orgUrl('/summary'), { fy });
  S.fy = S.summary.fy;
  bus.dispatchEvent(new CustomEvent('summary'));
  return S.summary;
}
export async function loadDocs() { S.docs = (await api('GET', orgUrl('/documents'))).documents; return S.docs; }
export async function loadUnread() {
  const n = (await api('GET', orgUrl('/notifications'))).notifications;
  S.unread = n.filter((x) => !x.read).length;
  bus.dispatchEvent(new CustomEvent('unread'));
  return n;
}

/** Reload everything the shell depends on after any data change. */
export async function refreshAll() {
  await loadOrg();
  await loadApp();
  await loadSummary(S.fy ?? S.org.inventory.organisation.reporting_fy);
  await loadDocs().catch(() => {});
  await loadUnread().catch(() => {});
}

/** POST JSON with upload progress (fetch cannot report upload progress). */
export function uploadJson(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('Authorization', `Bearer ${S.creds.token}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch { /* empty body */ }
      x.status >= 200 && x.status < 300 ? resolve(d) : reject(Object.assign(new Error(d.error ?? `HTTP ${x.status}`), { status: x.status, data: d }));
    };
    x.onerror = () => reject(new Error('Network error while uploading'));
    x.send(JSON.stringify(body));
  });
}

export async function blobUrl(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${S.creds.token}` } });
  if (!res.ok) throw new Error('File not available');
  return URL.createObjectURL(await res.blob());
}
export const toBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
