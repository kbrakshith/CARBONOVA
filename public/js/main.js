import { $, h, put, icon, toast } from './dom.js';
import { menu, skeleton, emptyState, btn } from './ui.js';
import { S, api, bus, loadCreds, forget } from './state.js';
import { refreshAll, loadSummary, loadUnread } from './session.js';
import { destroyCharts } from './chartjs.js';
import { openRecordForm } from './recordform.js';
import { reportModal } from './pages/reports.js';

const NAV = [
  ['WORKSPACE', [['overview', 'Overview', 'home'], ['footprint', 'My Carbon Footprint', 'leaf'], ['records', 'Activity Records', 'list'], ['documents', 'Documents', 'file'], ['reports', 'Reports', 'chart']]],
  ['MANAGEMENT', [['planner', 'Reduction Planner', 'target'], ['factors', 'Emission Factors', 'bolt'], ['profile', 'Business Profile', 'building']]],
  ['ACCOUNT', [['notifications', 'Notifications', 'bell'], ['settings', 'Settings', 'settings'], ['help', 'Help & Support', 'help']]],
];
const PAGES = {
  overview: () => import('./pages/overview.js'), footprint: () => import('./pages/footprint.js'), records: () => import('./pages/records.js'), documents: () => import('./pages/documents.js'),
  reports: () => import('./pages/reports.js'), planner: () => import('./pages/planner.js'), factors: () => import('./pages/factors.js'), profile: () => import('./pages/profile.js'),
  notifications: () => import('./pages/notifications.js'), settings: () => import('./pages/settings.js'), help: () => import('./pages/help.js'), onboarding: () => import('./pages/onboarding.js'),
};
const TITLE = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, l]) => [k, l])));
const GROUP = Object.fromEntries(NAV.flatMap(([g, items]) => items.map(([k]) => [k, g[0] + g.slice(1).toLowerCase()])));
const main = $('#main');
const app = $('.app');

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* session only */ } } };

export function go(to, force) {
  const target = `#${to}`;
  if (location.hash === target) { if (force) route(); } else location.hash = target;
}

// ------------------------------------------------------------ shell
function buildSide() {
  const o = S.org?.inventory.organisation;
  const pending = S.app?.documents_pending ?? 0;
  const links = NAV.flatMap(([g, items]) => [h('div', { class: 'nav-h' }, g), ...items.map(([k, label, ic]) => h('a', { class: 'nav-i', href: `#${k}`, 'data-page': k, title: label }, icon(ic), h('span', {}, label),
    k === 'documents' && pending ? h('span', { class: 'badge-n' }, String(pending)) : null, k === 'notifications' && S.unread ? h('span', { class: 'badge-n' }, String(S.unread)) : null))]);
  const collapse = h('button', { class: 'collapse-btn', type: 'button', 'aria-label': 'Collapse sidebar', onclick: () => { app.classList.toggle('collapsed'); store.set('cv_collapsed', app.classList.contains('collapsed') ? '1' : '0'); } }, icon('collapse'), h('span', {}, 'Collapse'));
  put($('.side'), h('a', { class: 'brand', href: '#overview' }, h('span', { class: 'logo' }, icon('leaf', 18)), h('span', { class: 'txt' }, 'CARBONOVA')), h('nav', { 'aria-label': 'Main' }, ...links),
    h('div', { class: 'side-foot' }, o ? h('a', { class: 'bizcard', href: '#profile', style: 'text-decoration:none' }, h('span', { class: 'avatar' }, o.legal_name.slice(0, 1).toUpperCase()), h('span', { class: 'biz-t' }, h('b', {}, o.legal_name), h('span', {}, `FY ${S.fy ?? o.reporting_fy}${S.app?.demo ? ' · demo' : ''}`))) : null, collapse));
}

function buildTop(page, params) {
  const o = S.org.inventory.organisation;
  const u = S.app.prefs?.user ?? { name: o.contact?.name || o.legal_name, email: o.contact?.email };
  const initials = (u.name || o.legal_name).split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const fySel = h('select', { 'aria-label': 'Reporting period', style: 'width:auto;height:34px', onchange: async (e) => { S.fy = e.target.value; await loadSummary(S.fy); route(); } }, S.summary.fys.map((f) => h('option', { value: f, selected: f === S.fy ? true : null }, `FY ${f}`)));
  const ctx = { overview: ['Add activity', 'plus', () => openRecordForm({ onSaved: async () => { await refreshAll(); route(); } })], footprint: ['Add activity', 'plus', () => openRecordForm({ onSaved: async () => { await refreshAll(); route(); } })], records: ['Add activity', 'plus', () => openRecordForm({ onSaved: async () => { await refreshAll(); route(); } })],
    documents: ['Upload document', 'upload', () => document.querySelector('.dropzone .btn')?.click()], reports: ['Generate report', 'plus', () => reportModal({ onDone: () => route() })], planner: ['Add activity', 'plus', () => openRecordForm({ onSaved: async () => { await refreshAll(); route(); } })] }[page];
  const av = h('button', { class: 'icon-btn', style: 'width:auto;padding:0 4px', 'aria-label': 'Account menu' }, h('span', { class: 'avatar' }, initials), icon('down', 14));
  const bell = h('button', { class: 'icon-btn', 'aria-label': S.unread ? `Notifications, ${S.unread} unread` : 'Notifications', onclick: () => go('notifications') }, icon('bell'), S.unread ? h('span', { class: 'dot' }) : null);
  put($('.top'), h('button', { class: 'icon-btn menu-toggle', 'aria-label': 'Open menu', onclick: () => app.classList.toggle('nav-open') }, icon('menu')),
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { class: 'c-h', href: '#overview' }, 'CARBONOVA'), h('span', { class: 'c-h' }, '/'), h('span', { class: 'c-h' }, GROUP[page] ?? ''), h('span', { class: 'c-h' }, '/'), h('b', { 'aria-current': 'page' }, TITLE[page] ?? '')),
    h('div', { class: 'top-spacer' }),
    h('div', { class: 'top-r' }, h('label', { class: 'sr', for: 'fy' }, 'Reporting period'), fySel, ctx ? btn(ctx[0], { kind: 'primary', ic: ctx[1], onclick: ctx[2] }) : null, bell, h('button', { class: 'icon-btn', 'aria-label': 'Help', onclick: () => go('help') }, icon('help')), h('div', { style: 'position:relative' }, av)));
  fySel.id = 'fy';
  menu(av, [{ header: `${u.name ?? ''}${u.email ? ' · ' + u.email : ''}` }, { label: 'Business profile', ic: 'building', onclick: () => go('profile') }, { label: 'Settings', ic: 'settings', onclick: () => go('settings') }, { label: 'Help & support', ic: 'help', onclick: () => go('help') }, { divider: true },
    { label: 'Switch workspace', ic: 'x', onclick: () => { forget(); location.hash = '#onboarding'; location.reload(); } }]);
}

// ------------------------------------------------------------ router
let token = 0;
function parse() {
  const raw = location.hash.slice(1);
  const [path, qs] = raw.split('?');
  const [page, sub] = path.split('/');
  return { page: page || '', sub, query: Object.fromEntries(new URLSearchParams(qs ?? '')) };
}

async function route() {
  const mine = ++token;
  destroyCharts();
  document.querySelectorAll('dialog.modal').forEach((d) => d.remove());
  let { page, sub, query } = parse();
  const authed = !!S.creds && !!S.app;
  document.body.classList.toggle('bare', !authed);
  if (!authed) page = 'onboarding';
  else if (!page || page === 'welcome') page = 'overview';
  else if (!S.app.onboarding.done && !['onboarding', 'documents', 'records', 'help'].includes(page) && S.app.onboarding.step >= 6) { /* allow free navigation after setup started */ }
  if (!PAGES[page]) page = authed ? 'overview' : 'onboarding';
  app.classList.remove('nav-open');
  document.title = `${TITLE[page] ?? 'Welcome'} · CARBONOVA`;
  if (authed) {
    buildSide(); buildTop(page, query);
    document.querySelectorAll('.nav-i').forEach((a) => a.setAttribute('aria-current', a.dataset.page === page ? 'page' : 'false'));
  }
  put(main, skeleton(3));
  try {
    const mod = await PAGES[page]();
    if (mine !== token) return;
    const root = h('div', { class: 'page' });
    put(main, root);
    if (page === 'documents' && sub) await mod.renderReview(root, sub, go);
    else await mod.render(root, go, query);
    if (mine === token) window.scrollTo({ top: 0 });
  } catch (e) {
    if (mine !== token) return;
    console.error(e);
    put(main, h('div', { class: 'card' }, emptyState({ icon: 'alert', title: 'Something went wrong', body: e.message, action: btn('Try again', { kind: 'primary', onclick: route }) })));
  }
}
window.addEventListener('hashchange', route);
bus.addEventListener('unread', () => { if (S.creds && S.app) { buildSide(); document.querySelectorAll('.nav-i').forEach((a) => a.setAttribute('aria-current', a.dataset.page === parse().page ? 'page' : 'false')); } });
$('.scrim').addEventListener('click', () => app.classList.remove('nav-open'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') app.classList.remove('nav-open'); });

(async () => {
  if (store.get('cv_collapsed') === '1') app.classList.add('collapsed');
  try {
    S.catalog = await api('GET', '/api/catalog');
    S.creds = loadCreds();
    if (S.creds) { try { await refreshAll(); } catch (e) { if (e.status === 401 || e.status === 404) forget(); else throw e; } }
    await route();
  } catch (e) { put(main, h('div', { class: 'card' }, h('h3', {}, 'Cannot reach the server'), h('p', {}, e.message), btn('Retry', { kind: 'primary', onclick: () => location.reload() }))); }
})();
void toast; void loadUnread;
