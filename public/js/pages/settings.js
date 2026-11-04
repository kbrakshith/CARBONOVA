import { h, put, icon, toast } from '../dom.js';
import { btn, tabs, formField, select, modal, confirmDialog, dataTable, status } from '../ui.js';
import { S, api, forget } from '../state.js';
import { orgUrl, refreshAll, aiReady } from '../session.js';

const ROLES = [['owner', 'Owner'], ['admin', 'Admin'], ['preparer', 'Preparer'], ['reviewer', 'Reviewer'], ['viewer', 'Viewer']];
const ROLE_HELP = { owner: 'Everything, including team and settings', admin: 'Manage records, documents, reports and team', preparer: 'Add and edit records and documents', reviewer: 'Review and approve records and reports', viewer: 'Read only' };
const TABS = [['personal', 'Personal'], ['org', 'Organisation'], ['team', 'Team'], ['notif', 'Notifications'], ['ai', 'AI assistance'], ['security', 'Security'], ['retention', 'Data retention'], ['account', 'Account']];

export async function render(root, go, query = {}) {
  await refreshAll();
  const body = h('div');
  const active = TABS.some(([k]) => k === query.tab) ? query.tab : 'personal';
  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Settings'))), tabs(TABS, active, (k) => { history.replaceState(null, '', `#settings?tab=${k}`); draw(k); }), body);
  const prefs = () => S.app.prefs ?? {};
  const savePrefs = async (p, msg = 'Saved.') => { await api('PUT', orgUrl('/prefs'), p); await refreshAll(); toast(msg); };

  function draw(k) {
    if (k === 'personal') {
      const u = prefs().user ?? {};
      const nm = h('input', { value: u.name ?? '' }), em = h('input', { type: 'email', value: u.email ?? '' });
      const nmF = formField('Full name', nm, { required: true }), emF = formField('Email', em, { required: true });
      return put(body, h('div', { class: 'card' }, h('h3', {}, 'Personal information'), h('div', { class: 'grid' }, nmF, emF, formField('Your role', h('input', { value: ROLES.find(([r]) => r === u.role)?.[1] ?? 'Owner', disabled: true }), { hint: 'Change roles under Team.' })),
        h('div', { class: 'row' }, btn('Save changes', { kind: 'primary', onclick: async () => { nmF.setError(''); emF.setError(''); if (!nm.value.trim()) return nmF.setError('Enter your name.'); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em.value)) return emF.setError('Enter a valid email.'); await savePrefs({ user: { ...u, name: nm.value.trim(), email: em.value.trim() } }, 'Personal information saved.').catch((e) => toast(e.message, 'err')); } }))));
    }
    if (k === 'org') {
      const o = S.org.inventory.organisation;
      return put(body, h('div', { class: 'card' }, h('h3', {}, 'Organisation'), h('dl', { class: 'kv' }, h('dt', {}, 'Name'), h('dd', {}, o.legal_name), h('dt', {}, 'Industry'), h('dd', {}, S.industry.label), h('dt', {}, 'Location'), h('dd', {}, [o.location, o.state].filter(Boolean).join(', ') || '-'), h('dt', {}, 'Reporting year'), h('dd', {}, `FY ${o.reporting_fy}`), h('dt', {}, 'Facilities'), h('dd', {}, String(o.facilities.length))),
        h('div', { class: 'row' }, btn('Edit in Business profile', { ic: 'edit', onclick: () => go('profile') }))));
    }
    if (k === 'team') {
      const tb = dataTable({ columns: [
        { key: 'name', label: 'Person', render: (m) => h('div', {}, h('b', {}, m.name || m.email), m.name ? h('div', { class: 'muted' }, m.email) : null) },
        { key: 'role', label: 'Role', render: (m) => select(ROLES, m.role, { 'aria-label': `Role for ${m.email}`, onchange: async (e) => { await api('POST', orgUrl(`/team/${m.id}/role`), { role: e.target.value }).then(() => toast('Role updated.')).catch((x) => toast(x.message, 'err')); } }) },
        { key: 'help', label: 'Can', render: (m) => h('span', { class: 'muted' }, ROLE_HELP[m.role]) },
        { key: 'a', label: '', render: (m) => (m.role === 'owner' && S.app.team.filter((x) => x.role === 'owner').length === 1 ? h('span', { class: 'muted' }, 'Only owner') : btn('Remove', { size: 'sm', ic: 'trash', onclick: async () => { if (!(await confirmDialog({ title: `Remove ${m.email}?`, message: 'They lose access to this workspace.', confirmText: 'Remove', danger: true }))) return; await api('POST', orgUrl(`/team/${m.id}/remove`), {}); await refreshAll(); toast('Removed.'); draw('team'); } })) },
      ], rows: S.app.team, pageSize: 10, caption: 'Team members' });
      tb.querySelector('table').classList.add('stack');
      return put(body, h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, 'Roles are recorded, but this prototype signs in with a single workspace access key. Per-person login and permission enforcement are not built yet, so do not rely on roles to restrict access.')),
        h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Team members'), btn('Invite member', { ic: 'plus', kind: 'primary', onclick: invite })), tb));
    }
    if (k === 'notif') {
      const n = { doc_review: true, missing_data: true, report_ready: true, email_digest: false, ...(prefs().notifications ?? {}) };
      const row = (key, title, desc) => h('li', {}, h('div', { class: 'grow-1' }, h('b', {}, title), h('div', { class: 'muted' }, desc)), h('input', { type: 'checkbox', checked: n[key] ? true : null, 'aria-label': title, style: 'width:20px;height:20px', onchange: async (e) => { n[key] = e.target.checked; await savePrefs({ notifications: n }, 'Notification preference saved.').catch((x) => toast(x.message, 'err')); } }));
      return put(body, h('div', { class: 'card' }, h('h3', {}, 'Notification preferences'), h('p', { class: 'muted' }, 'Controls what appears in your notifications list. Email delivery is not connected in this prototype.'), h('ul', { class: 'list' },
        row('doc_review', 'Documents waiting for review', 'When an upload needs checking.'), row('missing_data', 'Missing monthly records', 'When an expected bill or fuel record has not arrived.'), row('report_ready', 'Report reminders', 'When a year has data but no report.'), row('email_digest', 'Weekly email digest', 'Not available yet: email sending is not built.'))));
    }
    if (k === 'ai') {
      const on = !!prefs().ai_enabled;
      const msg = h('p', { class: 'muted' });
      const tog = h('input', { type: 'checkbox', checked: on ? true : null, disabled: S.ai?.configured ? null : true, 'aria-label': 'Turn on AI assistance', style: 'width:20px;height:20px', onchange: async (e) => { await savePrefs({ ai_enabled: e.target.checked }, e.target.checked ? 'AI assistance is on.' : 'AI assistance is off.').catch((x) => toast(x.message, 'err')); draw('ai'); } });
      return put(body, h('div', { class: 'card' }, h('h3', {}, 'AI assistance'),
        S.ai?.configured ? h('div', { class: 'banner ok' }, icon('check', 16), h('span', {}, `Connected to ${S.ai.provider}, model ${S.ai.model}.`)) : h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, 'No API key on the server. Add GROQ_API_KEY to the .env file and restart (see the README).')),
        h('ul', { class: 'list' }, h('li', {}, h('div', { class: 'grow-1' }, h('b', {}, 'Use AI assistance in this workspace'), h('div', { class: 'muted' }, 'Off by default. When on, short pieces of text from your documents and descriptions are sent to Groq to get suggestions.')), tog)),
        h('h4', {}, 'What AI does here'), h('ul', { class: 'muted' }, h('li', {}, 'Suggests values it finds in a document that the text reader missed. Each suggestion must quote the document, is marked "AI suggestion" and always needs your confirmation.'), h('li', {}, 'Suggests an activity type from your description.'), h('li', {}, 'Drafts a short report summary from your saved results. Any number not in your results rejects the draft.')),
        h('h4', {}, 'What AI never does'), h('ul', { class: 'muted' }, h('li', {}, 'Calculate, change or approve any emission figure, factor or quantity.'), h('li', {}, 'Approve a record or a report.'), h('li', {}, 'Read scanned pages or photos (it only sees text).')),
        h('h4', {}, 'Privacy'), h('p', { class: 'muted' }, 'Emails, phone numbers and long account numbers are removed before text is sent. Your API key stays on the server and is never shown in the browser. Do not turn this on if your documents must not leave your organisation.'),
        h('div', { class: 'row' }, btn('Test connection', { ic: 'check', disabled: !aiReady(), onclick: async () => { try { const r = await api('POST', orgUrl('/ai/test'), {}); toast(r.ok ? `Connection works (${r.model}).` : 'Connected, but the answer was unexpected.', r.ok ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } })), msg));
    }
    if (k === 'security') {
      return put(body, h('div', { class: 'card' }, h('h3', {}, 'Security'), h('dl', { class: 'kv' }, h('dt', {}, 'Sign-in method'), h('dd', {}, 'Workspace access key stored in this browser'), h('dt', {}, 'Two-factor / email OTP'), h('dd', {}, status('not_assessed', 'Not built yet')), h('dt', {}, 'Data isolation'), h('dd', {}, 'Each workspace has its own key. Other workspaces cannot read your records or documents.'),
        h('dt', {}, 'Audit trail'), h('dd', {}, 'Every change is logged in a tamper-evident hash chain (see below).')),
        h('div', { class: 'row' }, btn('Verify audit trail', { ic: 'check', onclick: async () => { const a = await api('GET', orgUrl('/audit')); toast(a.chain.ok ? `Audit trail intact (${a.chain.entries} events).` : `Audit trail broken at event ${a.chain.broken_at}.`, a.chain.ok ? 'ok' : 'err'); } }), btn('Sign out of this browser', { ic: 'x', onclick: signOut }))));
    }
    if (k === 'retention') {
      const cur = prefs().retention_days ?? 1825;
      const sel = select([[365, '1 year'], [730, '2 years'], [1825, '5 years'], [2555, '7 years']], Number(cur), { 'aria-label': 'Retention period' });
      return put(body, h('div', { class: 'card' }, h('h3', {}, 'Data retention'), h('p', { class: 'muted' }, 'How long evidence and records are meant to be kept. Assurers often ask for five years or more. Automatic deletion is not implemented: this records your policy, and deleted records are never purged from the audit trail.'),
        formField('Keep evidence and records for', sel), h('div', { class: 'row' }, btn('Save policy', { kind: 'primary', onclick: () => savePrefs({ retention_days: Number(sel.value) }, 'Retention policy saved.').catch((e) => toast(e.message, 'err')) }))));
    }
    return put(body, h('div', { class: 'card' }, h('h3', {}, 'Account management'), h('p', { class: 'muted' }, 'Take your data with you, or leave this browser.'),
      h('div', { class: 'row' }, btn('Export workspace data (JSON)', { ic: 'download', onclick: async () => { const d = await api('GET', orgUrl('')); const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d.inventory, null, 2)], { type: 'application/json' })), download: 'carbonova-workspace.json' }); document.body.append(a); a.click(); a.remove(); toast('Exported.'); } }), btn('Sign out of this browser', { ic: 'x', onclick: signOut })),
      h('p', { class: 'muted', style: 'margin-top:12px' }, 'Deleting a workspace is not available in this prototype.')));
  }
  async function signOut() {
    if (!(await confirmDialog({ title: 'Sign out of this browser?', message: 'Your data stays on the server, but this browser forgets the access key. Without the key you cannot reopen the workspace, so export your data first if unsure.', confirmText: 'Sign out', danger: true }))) return;
    forget(); location.hash = '#welcome'; location.reload();
  }
  function invite() {
    const em = h('input', { type: 'email' }), nm = h('input'), rl = select(ROLES, 'preparer');
    const emF = formField('Email', em, { required: true });
    const m = modal({ title: 'Invite team member', size: 'sm', body: [formField('Name', nm), emF, formField('Role', rl, { hint: ROLE_HELP.preparer })], footer: [btn('Cancel', { onclick: () => m.close() }), btn('Add member', { kind: 'primary', onclick: async () => {
      try { await api('POST', orgUrl('/team'), { email: em.value.trim(), name: nm.value.trim(), role: rl.value }); m.close(); await refreshAll(); toast('Member added. No email is sent in this prototype.'); draw('team'); } catch (e) { emF.setError(e.message); }
    } })] });
  }
  draw(active);
}
