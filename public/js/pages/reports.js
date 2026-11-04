import { h, put, icon, toast, fmt } from '../dom.js';
import { btn, dataTable, status, emptyState, modal, formField, select, menu } from '../ui.js';
import { S, api } from '../state.js';
import { orgUrl, refreshAll, aiReady } from '../session.js';

const STATUS_OPTS = [['draft', 'Draft'], ['self_declared', 'Self-declared'], ['internally_reviewed', 'Internally reviewed']];
const STATUS_HELP = {
  draft: 'Working copy. Not for sharing as evidence.',
  self_declared: 'You declare the data is accurate to the best of your knowledge. Not verified by anyone else.',
  internally_reviewed: 'A second person in your organisation has reviewed it. Needs validated factors. Still not external assurance.',
};

async function fetchReport(v, fmtName) {
  const res = await fetch(orgUrl(`/reports/${v}/${fmtName}`), { headers: { Authorization: `Bearer ${S.creds.token}` } });
  if (!res.ok) throw new Error('Could not load the report');
  return res.blob();
}
const preview = async (v) => { window.open(URL.createObjectURL(await fetchReport(v, 'html')), '_blank', 'noopener'); };
const printPdf = async (v) => {
  const w = window.open(URL.createObjectURL(await fetchReport(v, 'html')), '_blank');
  if (!w) return toast('Allow pop-ups to open the print dialog, then choose "Save as PDF".', 'err');
  w.addEventListener('load', () => setTimeout(() => w.print(), 400));
  toast('In the print dialog choose "Save as PDF".');
};
const csv = async (v) => { const a = h('a', { href: URL.createObjectURL(await fetchReport(v, 'csv')), download: `carbonova-report-v${v}.csv` }); document.body.append(a); a.click(); a.remove(); };

/** Generate a new report, or reissue a correction of an existing one. */
export function reportModal({ supersedes, fyPreset, onDone }) {
  const sm = S.summary;
  const fySel = select(sm.fys.map((f) => [f, `FY ${f}`]), fyPreset ?? sm.fy, { 'aria-label': 'Reporting period', onchange: () => loadElig() });
  const nameIn = h('input', { value: supersedes ? supersedes.name : `Supplier emissions data FY ${fyPreset ?? sm.fy}` });
  const stSel = select(STATUS_OPTS, 'self_declared', { 'aria-label': 'Review status', onchange: () => { help.textContent = STATUS_HELP[stSel.value]; } });
  const who = h('input', { placeholder: 'Name and designation', value: S.app.prefs?.user?.name ? `${S.app.prefs.user.name}, ${S.app.prefs.user.role ?? ''}`.replace(/, $/, '') : '' });
  const reason = h('textarea', { rows: 2, placeholder: 'What changed and why?' });
  const help = h('p', { class: 'muted' }, STATUS_HELP.self_declared);
  const eligBox = h('div');
  const errBox = h('div');
  const summary = h('textarea', { rows: 4, maxlength: 1500, placeholder: 'Optional. A short plain-English summary shown at the top of the report. The tables remain the authoritative figures.' });
  let aiDrafted = false;
  const draftBtn = aiReady() ? btn('Draft with AI', { ic: 'bolt', size: 'sm', onclick: async () => { draftBtn.classList.add('loading'); try { const r = await api('POST', orgUrl('/ai/narrative'), { fy: fySel.value }); summary.value = r.text; aiDrafted = true; toast('Draft added from your saved results. Read and edit it before issuing.'); } catch (e) { toast(e.message, 'err'); } finally { draftBtn.classList.remove('loading'); } } }) : null;
  const whoF = formField('Issued by (person responsible)', who, { required: true, hint: 'Recorded in the audit trail.' });
  const reasonF = formField('Reason for correction', reason, { required: true });
  let elig = null;

  async function loadElig() {
    put(eligBox, h('p', { class: 'muted' }, 'Checking this year...'));
    const s = fySel.value === sm.fy ? sm : await api('POST', orgUrl('/summary'), { fy: fySel.value });
    elig = s.current?.report_eligibility;
    if (!elig) return put(eligBox, h('div', { class: 'banner err' }, 'Nothing to report for this period.'));
    for (const o of stSel.options) o.disabled = !elig.allowed_statuses.includes(o.value);
    if (!elig.allowed_statuses.includes(stSel.value)) stSel.value = 'draft';
    help.textContent = STATUS_HELP[stSel.value];
    put(eligBox, elig.blocking.length ? h('div', { class: 'banner err' }, icon('alert', 16), h('div', {}, h('b', {}, 'Resolve these before issuing anything beyond a draft:'), h('ul', { style: 'margin:4px 0 0 16px;padding:0' }, elig.blocking.map((b) => h('li', {}, b.message))))) : null,
      elig.provisional_factors.length ? h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, `${elig.provisional_factors.length} emission factor(s) are provisional. The report will say so, and "Internally reviewed" is unavailable until they are validated.`)) : null);
  }
  const go_ = btn(supersedes ? 'Issue corrected report' : 'Generate report', { kind: 'primary', ic: 'file', onclick: async () => {
    const issued_by = who.value.trim();
    if (stSel.value !== 'draft' && !issued_by) return whoF.setError('Enter who is issuing this report.');
    if (supersedes && reason.value.trim().length < 5) return reasonF.setError('Explain the correction in a few words.');
    go_.classList.add('loading'); put(errBox);
    try {
      const run = await api('POST', orgUrl('/calculate'), { fy: fySel.value });
      const r = await api('POST', orgUrl('/reports'), { run_id: run.run_id, status: stSel.value, issued_by: issued_by || undefined, name: nameIn.value.trim() || undefined, ...(summary.value.trim() ? { narrative: { text: summary.value.trim(), ai: aiDrafted } } : {}), ...(supersedes ? { supersedes: supersedes.version, reason: reason.value.trim() } : {}) });
      m.close(); await refreshAll(); toast(`Report v${r.version} generated (${STATUS_OPTS.find(([k]) => k === r.status)[1]}).`); onDone?.(r);
    } catch (e) { go_.classList.remove('loading'); put(errBox, h('div', { class: 'banner err', role: 'alert' }, icon('alert', 16), h('span', {}, e.message))); }
  } });
  const m = modal({ title: supersedes ? `Reissue report v${supersedes.version}` : 'Generate report', body: [
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(220px,1fr))' }, formField('Reporting period', fySel), formField('Report name', nameIn), formField('Review status', stSel)), help, eligBox,
    formField('Summary for the report', summary, { hint: aiReady() ? 'You can draft this with AI from your saved results. Numbers not in your results are rejected. You are responsible for the final text.' : 'AI drafting is off. Turn it on in Settings > AI assistance.' }), draftBtn,
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(220px,1fr))' }, whoF, supersedes ? reasonF : null), errBox,
    h('p', { class: 'muted' }, 'The report is titled "BRSR-aligned supplier emissions data". It is supporting evidence for a buyer, not a BRSR filing, an ISO 14064 verification or an assurance statement.')],
  footer: [btn('Cancel', { onclick: () => m.close() }), go_] });
  loadElig();
}

export async function render(root, go, query = {}) {
  await refreshAll();
  const reports = S.org.reports.slice().sort((a, b) => b.version - a.version);
  const supersededBy = (r) => reports.find((x) => x.supersedes === r.version)?.version;
  const columns = [
    { key: 'name', label: 'Report', sortable: true, render: (r) => h('div', {}, h('b', {}, r.name ?? `Report v${r.version}`), h('div', { class: 'muted' }, `Version ${r.version}${r.supersedes ? ` · corrects v${r.supersedes}` : ''}${supersededBy(r) ? ` · superseded by v${supersededBy(r)}` : ''}`)) },
    { key: 'fy', label: 'Reporting period', sortable: true, render: (r) => `FY ${r.fy ?? '-'}` },
    { key: 'at', label: 'Generated', sortable: true, render: (r) => new Date(r.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
    { key: 'total_t', label: 'Total (tCO₂e)', class: 'num', sortable: true, render: (r) => (r.total_t != null ? fmt(r.total_t, 1) : '-') },
    { key: 'status', label: 'Review status', sortable: true, render: (r) => status(r.status) },
    { key: 'act', label: 'Actions', render: (r) => { const b = h('button', { class: 'icon-btn', 'aria-label': `More actions for ${r.name}` }, icon('down', 16)); menu(b, [
      { label: 'Preview', ic: 'eye', onclick: () => preview(r.version).catch((e) => toast(e.message, 'err')) }, { label: 'Download PDF (print)', ic: 'download', onclick: () => printPdf(r.version).catch((e) => toast(e.message, 'err')) }, { label: 'Export CSV', ic: 'download', onclick: () => csv(r.version).catch((e) => toast(e.message, 'err')) },
      { divider: true }, { label: 'Version history', ic: 'list', onclick: () => history_(r) }, { label: 'Reissue corrected report', ic: 'edit', onclick: () => reportModal({ supersedes: r, fyPreset: r.fy, onDone: () => go('reports', true) }) }]);
      return h('div', { class: 'cell-act' }, btn('Preview', { size: 'sm', onclick: () => preview(r.version).catch((e) => toast(e.message, 'err')) }), b); } },
  ];
  function history_(r) {
    const vs = reports.filter((x) => x.fy === r.fy).sort((a, b) => a.version - b.version);
    const m = modal({ title: `Version history · FY ${r.fy}`, body: h('ul', { class: 'list' }, vs.map((v) => h('li', {}, h('span', { class: `dotmark ${v.version === Math.max(...vs.map((x) => x.version)) ? 'ok' : ''}` }), h('div', { class: 'grow-1' }, h('b', {}, `Version ${v.version}`), ' ', status(v.status), h('div', { class: 'muted' }, `${new Date(v.at).toLocaleString('en-IN')} · ${v.issued_by ?? 'no issuer (draft)'} · ${fmt(v.total_t, 1)} tCO₂e`), v.reason ? h('div', {}, `Correction: ${v.reason}`) : null, h('div', { class: 'muted' }, `Hash ${v.html_sha256.slice(0, 16)}…`))))), footer: [btn('Close', { onclick: () => m.close() })] });
  }
  const table = dataTable({ columns, rows: reports, sort: { key: 'at', dir: 'desc' }, pageSize: 8, caption: 'Reports', empty: emptyState({ icon: 'file', title: 'No reports yet', body: 'Generate your first report from the records you have approved.', action: btn('Generate report', { kind: 'primary', ic: 'plus', onclick: () => reportModal({ onDone: () => go('reports', true) }) }) }) });
  table.querySelector('table').classList.add('stack');
  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Reports'), h('p', { class: 'sub' }, 'BRSR-aligned supplier emissions data, built from approved records and a saved calculation.')), h('div', { class: 'head-actions' }, btn('Generate report', { kind: 'primary', ic: 'plus', onclick: () => reportModal({ onDone: () => go('reports', true) }) }))),
    h('div', { class: 'card' }, h('div', { class: 'tablewrap' }, h('div', { class: 'row-tight', style: 'flex-wrap:wrap;margin-bottom:12px' }, h('span', { class: 'muted' }, 'Status meanings:'), status('self_declared'), status('internally_reviewed'), status('externally_assured'), h('span', { class: 'muted' }, 'External assurance can only be recorded by an independent assurer, not in this app.')), table)),
    h('div', { class: 'card' }, h('h3', {}, 'What each report contains'), h('p', { class: 'muted' }, 'Business information, organisational boundary, reporting period, Scope 1 and 2, assessed Scope 3 categories, activity data, emission factors with sources, methodology and assumptions, exclusions and data-quality notes, intensity (when turnover is set), and review status. Every report carries the factor-register and result hashes so it can be reproduced.')));
  if (query.new) reportModal({ onDone: () => go('reports', true) });
}
