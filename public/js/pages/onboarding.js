import { h, put, icon, toast, fmt } from '../dom.js';
import { btn, formField, select, stat, t } from '../ui.js';
import { S, api, saveCreds, forget } from '../state.js';
import { orgUrl, refreshAll } from '../session.js';
import { uploader, renderReview } from './documents.js';
import { openRecordForm } from '../recordform.js';
import { openCalc } from '../calcdetail.js';

const STEPS = ['Welcome', 'Business', 'Industry and location', 'Reporting period', 'Boundary and facilities', 'First data', 'Review', 'First result'];
const DRAFT = 'carbonova_onboarding';
const STATES = ['Andhra Pradesh', 'Delhi', 'Gujarat', 'Haryana', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal', 'Other'];
const TYPES = ['Micro enterprise - manufacturing', 'Small enterprise - manufacturing', 'Medium enterprise - manufacturing', 'Micro enterprise - services', 'Small enterprise - services', 'Medium enterprise - services', 'Trader / distributor', 'Other'];
const fyOptions = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return [y, y - 1, y - 2].map((a) => `${a}-${String((a + 1) % 100).padStart(2, '0')}`); };

const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT)) ?? {}; } catch { return {}; } };
const saveDraft = (d) => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* session only */ } };

export async function render(root, go) {
  const hasOrg = !!S.creds && !!S.app;
  let draft = loadDraft();
  let step = hasOrg ? Math.max(S.app.onboarding.step, 6) : Math.min(draft.step ?? 1, 5);
  const shell = h('div', { class: 'onb' });
  put(root, shell);

  const bar = () => h('div', {}, h('div', { class: 'steps', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': 8, 'aria-valuenow': step, 'aria-label': 'Setup progress' }, STEPS.map((_, i) => h('i', { class: i < step ? 'on' : '' }))),
    h('p', { class: 'muted' }, `Step ${step} of 8: ${STEPS[step - 1]}`));
  const persist = async () => { draft.step = step; if (!hasOrg && !S.creds) saveDraft(draft); else await api('PUT', orgUrl('/onboarding'), { step, done: false }).catch(() => {}); };
  const goStep = async (n) => { step = n; await persist(); draw(); };
  const nav = (back, next, nextLabel = 'Continue', nextDisabled) => h('div', { class: 'row', style: 'justify-content:space-between' }, back ? btn('Back', { ic: 'left', onclick: () => goStep(step - 1) }) : h('span'), h('div', { class: 'row-tight' }, h('span', { class: 'muted' }, 'Progress is saved automatically.'), next ? btn(nextLabel, { kind: 'primary', onclick: next, disabled: nextDisabled }) : null));

  async function draw() {
    if (step === 1) {
      return put(shell, h('div', { class: 'welcome' }, h('div', { class: 'logo', style: 'width:48px;height:48px;margin:0 auto 14px;border-radius:14px;background:var(--green);display:grid;place-items:center;color:#fff' }, icon('leaf', 26)),
        h('h1', {}, 'Welcome to CARBONOVA'), h('p', { class: 'lead' }, 'Carbon footprint reporting made simple. We will guide you from your first electricity bill to a report your customers can use. It takes about ten minutes and you can stop and continue later.'),
        h('div', { class: 'kpi-3' }, h('div', {}, h('b', {}, '1. Tell us about your business'), h('p', { class: 'muted' }, 'Name, industry and where you operate.')), h('div', {}, h('b', {}, '2. Add one bill'), h('p', { class: 'muted' }, 'Upload it or type it in.')), h('div', {}, h('b', {}, '3. See your footprint'), h('p', { class: 'muted' }, 'With every calculation explained.'))),
        h('div', { class: 'row', style: 'justify-content:center' }, btn('Start setup', { kind: 'primary', size: 'lg', onclick: () => goStep(2) }), btn('Explore with demo data', { size: 'lg', onclick: async () => { const r = await api('POST', '/api/demo').catch((e) => { toast(e.message, 'err'); return null; }); if (!r) return; S.creds = r; saveCreds(); await refreshAll(); toast('Demo workspace loaded. It is illustrative data for a fictional unit.'); go('overview'); } })),
        h('p', { class: 'muted', style: 'margin-top:18px' }, 'The demo is a fictional iron-casting unit in Tamil Nadu. Its figures are illustrative.')));
    }
    if (step === 2) {
      const nm = h('input', { value: draft.legal_name ?? '', maxlength: 120, autocomplete: 'organization' }), ty = select(TYPES.map((x) => [x, x]), draft.business_type ?? TYPES[1]);
      const cn = h('input', { value: draft.contact_name ?? '' }), ce = h('input', { type: 'email', value: draft.contact_email ?? '' });
      const nmF = formField('Business name', nm, { required: true, hint: 'As it should appear on your report.' }), ceF = formField('Contact email', ce, { hint: 'Optional. Used on the report as the point of contact.' });
      return put(shell, bar(), h('div', { class: 'card' }, h('h2', {}, 'Tell us about your business'), h('div', { class: 'grid' }, nmF, formField('Business type', ty), formField('Contact person', cn), ceF)),
        nav(true, () => { nmF.setError(''); ceF.setError(''); if (!nm.value.trim()) return nmF.setError('Enter your business name.'); if (ce.value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ce.value)) return ceF.setError('That email does not look right.'); Object.assign(draft, { legal_name: nm.value.trim(), business_type: ty.value, contact_name: cn.value, contact_email: ce.value }); goStep(3); }));
    }
    if (step === 3) {
      const ind = select(S.catalog.industries.map((i) => [i.id, i.label]), draft.industry ?? 'generic_msme'), st = select(STATES.map((x) => [x, x]), draft.state ?? 'Tamil Nadu'), loc = h('input', { value: draft.location ?? '', placeholder: 'e.g. Coimbatore' });
      const help = h('p', { class: 'muted' });
      const sync = () => { const i = S.catalog.industries.find((x) => x.id === ind.value); help.textContent = i ? `We will follow your product through ${i.stage_count} stage${i.stage_count > 1 ? 's' : ''} and show which wastes to expect at each. Pick "Other MSME" if none fits.` : ''; };
      ind.addEventListener('change', sync); sync();
      return put(shell, bar(), h('div', { class: 'card' }, h('h2', {}, 'Your industry and location'), h('div', { class: 'grid' }, formField('Industry', ind), formField('State', st), formField('City or area', loc)), help),
        nav(true, () => { Object.assign(draft, { industry: ind.value, state: st.value, location: loc.value }); goStep(4); }));
    }
    if (step === 4) {
      const fy = select(fyOptions().map((x) => [x, `FY ${x}`]), draft.reporting_fy ?? fyOptions()[0]), rev = h('input', { type: 'number', min: '0', value: draft.revenue_inr ?? '' });
      return put(shell, bar(), h('div', { class: 'card' }, h('h2', {}, 'Choose your reporting period'), h('p', { class: 'muted' }, 'India reports on the financial year, 1 April to 31 March. Pick the year you want a report for. You can add earlier years later.'),
        h('div', { class: 'grid' }, formField('Financial year', fy), formField('Annual turnover (INR)', rev, { hint: 'Optional. Lets us show emissions per ₹ million of turnover.' }))), nav(true, () => { Object.assign(draft, { reporting_fy: fy.value, revenue_inr: rev.value ? Number(rev.value) : null }); goStep(5); }));
    }
    if (step === 5) {
      const cons = select([['operational_control', 'Operational control (recommended)'], ['financial_control', 'Financial control'], ['equity_share', 'Equity share']], draft.consolidation_approach ?? 'operational_control');
      draft.facilities ??= [{ id: 'F1', name: draft.location ? `${draft.location} site` : 'Main site', state: draft.state }];
      const facBox = h('div');
      const err = h('div');
      const drawFac = () => put(facBox, draft.facilities.map((f, i) => h('div', { class: 'row-tight', style: 'margin-bottom:8px' }, h('input', { value: f.name, 'aria-label': `Facility ${i + 1} name`, oninput: (e) => { f.name = e.target.value; } }), draft.facilities.length > 1 ? btn('', { ic: 'trash', size: 'sm', title: 'Remove facility', onclick: () => { draft.facilities.splice(i, 1); drawFac(); } }) : null)),
        btn('Add another facility', { ic: 'plus', size: 'sm', onclick: () => { draft.facilities.push({ id: `F${draft.facilities.length + 1}`, name: '', state: draft.state }); drawFac(); } }));
      drawFac();
      return put(shell, bar(), h('div', { class: 'card' }, h('h2', {}, 'Set your reporting boundary'), h('p', { class: 'muted' }, 'The boundary says which sites and equipment count as yours. "Operational control" means sites you run, whether or not you own them.'),
        formField('Consolidation approach', cons), h('h4', { style: 'margin-top:14px' }, 'Facilities'), facBox, err),
        nav(true, async () => {
          if (draft.facilities.some((f) => !f.name.trim())) return put(err, h('div', { class: 'banner err' }, 'Give every facility a name.'));
          draft.consolidation_approach = cons.value; draft.facilities.forEach((f, i) => { f.id = `F${i + 1}`; });
          try {
            const r = await api('POST', '/api/orgs', { legal_name: draft.legal_name, industry: draft.industry, reporting_fy: draft.reporting_fy, consolidation_approach: draft.consolidation_approach, facilities: draft.facilities, revenue_inr: draft.revenue_inr, business_type: draft.business_type, state: draft.state, location: draft.location, contact: { name: draft.contact_name, email: draft.contact_email } });
            S.creds = { id: r.id, token: r.token }; saveCreds(); try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
            await refreshAll(); toast('Workspace created. Your access key is stored in this browser.'); await goStep(6);
          } catch (e) { put(err, h('div', { class: 'banner err', role: 'alert' }, e.data?.errors ? e.data.errors.map((x) => x.message).join(' ') : e.message)); }
        }, 'Create workspace'));
    }
    if (step === 6) {
      return put(shell, bar(), h('div', { class: 'card' }, h('h2', {}, 'Add your first data'), h('p', { class: 'muted' }, 'Start with one electricity bill. Upload it and we will suggest the values, or type them in yourself.'),
        uploader({ onUploaded: async (d) => { draft.docId = d.id; await goStep(7); } }),
        h('div', { class: 'row' }, btn('Or add a record by hand', { ic: 'edit', onclick: () => openRecordForm({ kind: 'electricity', onSaved: async () => { await refreshAll(); await goStep(8); } }) }))),
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('span'), btn('Skip for now', { kind: 'ghost', onclick: async () => { await api('PUT', orgUrl('/onboarding'), { step: 8, done: true }); go('overview'); } })));
    }
    if (step === 7) {
      const host = h('div');
      put(shell, bar(), host, h('div', { class: 'row' }, btn('Back to upload', { ic: 'left', onclick: () => goStep(6) })));
      const pending = S.docs.find((d) => d.id === draft.docId) ?? S.docs.find((d) => d.status === 'needs_review');
      if (!pending) return goStep(6);
      return renderReview(host, pending.id, go, { embedded: true, onDone: () => goStep(8) });
    }
    // step 8
    await refreshAll();
    const r = S.summary.current?.result;
    const first = r?.lines.find((l) => l.type !== 'waste');
    return put(shell, bar(), h('div', { class: 'card' }, h('h2', {}, r?.lines.length ? 'Your first result' : 'Nearly there'),
      r?.lines.length ? [h('div', { class: 'metrics' }, stat('Total emissions', h('span', {}, t(r.totals_t.scope1_2_3_assessed_t, 3), h('small', {}, 'tCO₂e'))), stat('Scope 1', t(r.totals_t.scope1_t, 3)), stat('Scope 2', t(r.totals_t.scope2_location_t, 3)), stat('Records', String(r.lines.length))),
        h('p', {}, 'This is the first of many figures: each one can be opened to see exactly how it was calculated.'), first ? btn('See how this was calculated', { ic: 'chart', onclick: () => openCalc(first) }) : null] : h('p', { class: 'muted' }, 'No approved records yet. Add a record to see a result.')),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Go to my overview', { kind: 'primary', onclick: async () => { await api('PUT', orgUrl('/onboarding'), { step: 8, done: true }); await refreshAll(); go('overview'); } })));
  }
  void forget; void fmt;
  await draw();
}
