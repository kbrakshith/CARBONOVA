import { h, put, icon, toast, fmt } from '../dom.js';
import { btn, dataTable, status, emptyState, menu, confirmDialog, formField, select } from '../ui.js';
import { S, api } from '../state.js';
import { orgUrl, refreshAll, uploadJson, blobUrl, toBase64, aiReady } from '../session.js';

export const DOC_TYPES = [['electricity_bill', 'Electricity bill'], ['fuel_receipt', 'Fuel receipt'], ['purchase_invoice', 'Purchase invoice'], ['transport_receipt', 'Transport receipt'], ['waste_record', 'Waste record'], ['csv', 'CSV file']];
const TYPE_LABEL = Object.fromEntries(DOC_TYPES);
const OK_EXT = /\.(pdf|png|jpe?g|csv)$/i;
const MAX = 6 * 1024 * 1024;
const LOW = 0.75;
const guessType = (name) => (/\.csv$/i.test(name) ? 'csv' : /elec|bill|tangedco|tneb|eb_/i.test(name) ? 'electricity_bill' : /fuel|diesel|petrol|hsd|lpg|receipt/i.test(name) ? 'fuel_receipt' : /transport|trip|freight|lorry/i.test(name) ? 'transport_receipt' : /waste|scrap|manifest/i.test(name) ? 'waste_record' : /invoice|inv_/i.test(name) ? 'purchase_invoice' : null);
const size = (n) => (n > 1e6 ? `${fmt(n / 1e6, 1)} MB` : `${Math.max(Math.round(n / 1e3), 1)} KB`);

/** Drag-and-drop uploader with per-file progress. Used by the Documents page and onboarding. */
export function uploader({ onUploaded }) {
  const typeSel = select([['auto', 'Detect from file name'], ...DOC_TYPES], 'auto', { 'aria-label': 'Document type' });
  const list = h('div', { class: 'row-list', style: 'margin-top:12px;display:grid;gap:8px' });
  const input = h('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.csv', hidden: true, 'aria-label': 'Choose files' });
  const zone = h('div', { class: 'dropzone', tabindex: 0, role: 'button', 'aria-label': 'Drop files here or press Enter to browse' },
    h('div', { class: 'big-ico' }, icon('upload', 28)), h('p', {}, h('b', {}, 'Drag and drop files here'), ' or '), btn('Browse files', { kind: 'primary', onclick: () => input.click() }),
    h('p', { class: 'muted', style: 'margin-top:10px' }, 'PDF, PNG, JPG or CSV, up to 6 MB. Electricity bills, fuel receipts, purchase invoices, transport receipts, waste records.'));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
  zone.addEventListener('drop', (e) => handle([...e.dataTransfer.files]));
  input.addEventListener('change', () => { handle([...input.files]); input.value = ''; });

  async function handle(files) {
    for (const file of files) {
      const row = h('div', { class: 'card', style: 'margin:0;padding:10px 12px' });
      const bar = h('i', { style: 'width:0%' });
      const msg = h('span', { class: 'muted' }, 'Checking...');
      put(row, h('div', { class: 'between' }, h('b', {}, file.name), msg), h('div', { class: 'progress' }, bar));
      list.prepend(row);
      if (!OK_EXT.test(file.name)) { msg.textContent = 'Not supported. Use PDF, PNG, JPG or CSV.'; msg.style.color = 'var(--red)'; continue; }
      if (file.size > MAX) { msg.textContent = `Too large (${size(file.size)}). Maximum is 6 MB.`; msg.style.color = 'var(--red)'; continue; }
      const type = typeSel.value === 'auto' ? guessType(file.name) : typeSel.value;
      if (!type) { msg.textContent = 'Could not tell the document type from its name. Choose a type above and upload again.'; msg.style.color = 'var(--red)'; continue; }
      try {
        msg.textContent = `Uploading as ${TYPE_LABEL[type]}...`;
        const data = await toBase64(file);
        const r = await uploadJson(orgUrl('/documents'), { name: file.name, doc_type: type, data }, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
        bar.style.width = '100%'; msg.textContent = 'Uploaded. Extracting values...';
        await refreshAll();
        msg.textContent = 'Ready for review';
        row.append(btn('Review now', { kind: 'primary', size: 'sm', onclick: () => onUploaded(r.document) }));
        if (files.length === 1) onUploaded(r.document);
      } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = e.status === 409 ? `Duplicate: ${e.message}` : e.message;
        if (e.status === 409 && e.data?.existing) row.append(btn('Open existing', { size: 'sm', onclick: () => onUploaded(e.data.existing) }));
      }
    }
  }
  return h('div', {}, h('div', { class: 'row', style: 'margin:0 0 10px' }, h('div', { class: 'field', style: 'min-width:240px' }, h('label', {}, 'Document type'), typeSel)), zone, input, list);
}

export async function render(root, go) {
  await refreshAll();
  const docs = S.docs;
  const open = (d) => go(`documents/${d.id}`);
  const columns = [
    { key: 'name', label: 'Document', sortable: true, render: (d) => h('div', {}, h('b', {}, d.name), d.demo ? h('div', { class: 'muted' }, 'Demo document') : null) },
    { key: 'doc_type', label: 'Type', sortable: true, render: (d) => TYPE_LABEL[d.doc_type] },
    { key: 'uploaded_at', label: 'Uploaded', sortable: true, render: (d) => new Date(d.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) },
    { key: 'size', label: 'Size', class: 'num', render: (d) => size(d.size) },
    { key: 'status', label: 'Processing status', sortable: true, render: (d) => h('div', {}, status(d.status === 'needs_review' ? 'needs_review' : d.status), d.status === 'needs_review' && !d.extraction.has_text && d.doc_type !== 'csv' ? h('div', { class: 'muted' }, 'No readable text: manual entry') : null) },
    { key: 'act', label: 'Actions', render: (d) => { const b = h('button', { class: 'icon-btn', 'aria-label': `More actions for ${d.name}` }, icon('down', 16)); menu(b, () => [{ label: d.status === 'needs_review' ? 'Review values' : 'View', ic: 'eye', onclick: () => open(d) }, ...(d.status === 'needs_review' ? [{ divider: true }, { label: 'Reject document', ic: 'x', danger: true, onclick: async () => { const reason = await confirmDialog({ title: 'Reject this document?', message: 'It will not be used for any record. The file and your reason stay in the audit trail.', confirmText: 'Reject', danger: true, reasonLabel: 'Reason' }); if (!reason) return; await api('POST', orgUrl(`/documents/${d.id}/reject`), { reason }); toast('Document rejected.'); go('documents', true); } }] : [])]);
      return h('div', { class: 'cell-act' }, btn(d.status === 'needs_review' ? 'Review' : 'View', { size: 'sm', kind: d.status === 'needs_review' ? 'primary' : 'secondary', onclick: () => open(d) }), b); } },
  ];
  const table = dataTable({ columns, rows: docs, sort: { key: 'uploaded_at', dir: 'desc' }, pageSize: 8, caption: 'Uploaded documents', empty: emptyState({ icon: 'file', title: 'No documents yet', body: 'Upload an electricity bill or fuel receipt to start.' }) });
  table.querySelector('table').classList.add('stack');
  const pending = docs.filter((d) => d.status === 'needs_review').length;
  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Document Centre'), h('p', { class: 'sub' }, 'Upload bills and receipts, check the values CARBONOVA suggests, then approve them as records.'))),
    h('div', { class: 'banner info' }, icon('info', 16), h('span', {}, 'Extraction here is a rule-based text reader, not OCR or AI. It reads PDFs that contain text and CSV files. Scanned PDFs and photos need their values typed in. Every value is a suggestion until you confirm it.')),
    pending ? h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, `${pending} document${pending > 1 ? 's' : ''} waiting for your review.`)) : null,
    h('div', { class: 'card' }, h('h3', {}, 'Upload'), uploader({ onUploaded: (d) => go(`documents/${d.id}`) })),
    h('div', { class: 'card' }, h('h3', {}, 'Upload history'), table));
}

// ------------------------------------------------------------------ review
export async function renderReview(root, id, go, { embedded = false, onDone } = {}) {
  await refreshAll();
  const d = S.docs.find((x) => x.id === id);
  if (!d) return put(root, emptyState({ icon: 'file', title: 'Document not found', action: btn('Back to documents', { onclick: () => go('documents') }) }));
  const org = S.org.inventory.organisation;
  const back = embedded ? null : h('p', {}, h('a', { href: '#documents' }, '← All documents'));

  const previewPane = h('div', { class: 'preview-pane' }, h('p', { class: 'muted', style: 'padding:16px' }, 'Loading preview...'));
  blobUrl(orgUrl(`/documents/${d.id}/file`)).then(async (url) => {
    if (d.mime.startsWith('image/')) put(previewPane, h('img', { src: url, alt: `Original document ${d.name}` }));
    else if (d.mime === 'text/csv') put(previewPane, h('pre', { style: 'padding:12px;margin:0;overflow:auto;max-height:560px;font-size:12.5px' }, await (await fetch(url)).text()));
    else put(previewPane, h('object', { data: url, type: 'application/pdf', 'aria-label': `Original document ${d.name}` }, h('p', { style: 'padding:16px' }, 'Your browser cannot preview this PDF. ', h('a', { href: url, download: d.name }, 'Download it'), ' to check the values.')));
  }).catch(() => put(previewPane, h('div', { style: 'padding:16px' }, h('p', { class: 'muted' }, 'The original file is not stored for this record.'))));

  const head = h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, d.name), h('p', { class: 'sub' }, `${TYPE_LABEL[d.doc_type]} · uploaded ${new Date(d.uploaded_at).toLocaleString('en-IN')} · ${status(d.status).textContent}`)));
  const note = h('div', { class: 'banner info' }, icon('info', 16), h('span', {}, `${d.extraction.service}. ${d.extraction.notes.join(' ')} Suggestions are not verified facts.`));

  if (d.status === 'confirmed' || d.status === 'rejected') {
    return put(root, back, head, d.status === 'confirmed'
      ? h('div', { class: 'card' }, h('p', {}, 'Confirmed. Records created from this document: ', d.activity_ids.join(', ') || 'none', '.'), btn('Open activity records', { onclick: () => go('records') }))
      : h('div', { class: 'card' }, h('p', {}, 'This document was rejected and is not used.')), h('div', { class: 'review' }, previewPane));
  }

  const errBox = h('div');
  const facility = h('select', { 'aria-label': 'Facility' }, org.facilities.map((f) => h('option', { value: f.id }, f.name)));
  const submitDone = async (r) => { await refreshAll(); toast(`Approved. ${r.created.length} record${r.created.length > 1 ? 's' : ''} created and included in your footprint.`); if (onDone) onDone(r); else go('records'); };
  const fail = (e) => put(errBox, h('div', { class: 'banner err', role: 'alert' }, icon('alert', 16), h('span', {}, e.data?.errors ? e.data.errors.map((x) => x.message).join(' ') : e.message)));
  const reject = btn('Reject document', { ic: 'x', onclick: async () => { const reason = await confirmDialog({ title: 'Reject this document?', message: 'It will not be used for any record.', confirmText: 'Reject', danger: true, reasonLabel: 'Reason' }); if (!reason) return; await api('POST', orgUrl(`/documents/${d.id}/reject`), { reason }); await refreshAll(); toast('Document rejected.'); go('documents'); } });

  // ---- CSV
  if (d.doc_type === 'csv') {
    const picked = new Set(d.extraction.rows.filter((r) => !r.errors.length).map((r) => r.line));
    const ok = d.extraction.rows.filter((r) => !r.errors.length).length;
    const confirmBtn = btn(`Import ${picked.size} row(s)`, { kind: 'primary', ic: 'check', onclick: async () => { try { confirmBtn.classList.add('loading'); await submitDone(await api('POST', orgUrl(`/documents/${d.id}/confirm`), { rows: [...picked], facility_id: facility.value })); } catch (e) { confirmBtn.classList.remove('loading'); fail(e); } } });
    return put(root, back, head, note, h('div', { class: 'review' }, previewPane, h('div', { class: 'card' }, h('h3', {}, 'Rows found'), d.extraction.notes.length ? d.extraction.notes.map((n) => h('p', { class: 'msg warning' }, n)) : null,
      formField('Facility for these rows', facility), h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['', 'Line', 'Type', 'Period', 'Quantity', 'Check'].map((x) => h('th', {}, x)))),
        h('tbody', {}, d.extraction.rows.map((r) => h('tr', { class: r.errors.length ? 'lowconf' : '' }, h('td', {}, r.errors.length ? null : h('input', { type: 'checkbox', checked: true, 'aria-label': `Import line ${r.line}`, onchange: (e) => { e.target.checked ? picked.add(r.line) : picked.delete(r.line); confirmBtn.lastChild.textContent = `Import ${picked.size} row(s)`; confirmBtn.disabled = !picked.size; } })), h('td', {}, r.line), h('td', {}, `${r.type}${r.fuel ? ' ' + r.fuel : ''}`), h('td', {}, `${r.start} to ${r.end}`), h('td', {}, `${r.quantity} ${r.unit}`), h('td', {}, r.errors.length ? r.errors.join('; ') : status('measured', 'Valid')))))), ok ? null : null), errBox, h('div', { class: 'row' }, confirmBtn, reject))));
  }

  // ---- text / image documents
  const KIND_BY_TYPE = { electricity_bill: 'electricity', fuel_receipt: 'diesel', transport_receipt: 'transport', purchase_invoice: 'fuel_other', waste_record: 'fuel_other' };
  const fuelField = d.extraction.fields.find((f) => f.key === 'fuel')?.value;
  let kind = d.doc_type === 'fuel_receipt' && ['diesel', 'petrol', 'lpg'].includes(fuelField) ? fuelField : KIND_BY_TYPE[d.doc_type];
  const kindSel = select([['electricity', 'Electricity consumption'], ['diesel', 'Diesel'], ['petrol', 'Petrol'], ['lpg', 'LPG'], ['transport', 'Transport fuel (hired vehicles)'], ['fuel_other', 'Other fuel']], kind, { 'aria-label': 'What this document records', onchange: (e) => { kind = e.target.value; unitSel.value = kind === 'electricity' ? 'kWh' : kind === 'lpg' ? 'kg' : 'L'; sync(); } });
  const unitSel = select([['kWh', 'kWh'], ['L', 'litres'], ['kg', 'kg'], ['t', 'tonnes']], kind === 'electricity' ? 'kWh' : kind === 'lpg' ? 'kg' : (d.extraction.fields.find((f) => f.key === 'quantity')?.unit ?? 'L'), { 'aria-label': 'Unit' });

  const original = {}; const inputs = {}; const checks = {};
  const SHOWN = d.doc_type === 'electricity_bill' ? ['period_start', 'period_end', 'quantity', 'meter_id', 'vendor', 'billing_date'] : ['period_start', 'period_end', 'quantity', 'vendor', ...(d.doc_type === 'fuel_receipt' ? ['fuel'] : [])];
  const REQUIRED = ['period_start', 'quantity'];
  const rows = SHOWN.map((key) => {
    const fld = d.extraction.fields.find((x) => x.key === key) ?? { key, label: key, value: '', confidence: 0, source_ref: 'not found in document' };
    original[key] = fld.value;
    const type = key.startsWith('period') || key === 'billing_date' ? 'date' : key === 'quantity' ? 'number' : 'text';
    const inp = h('input', { type, step: 'any', value: fld.value, 'aria-label': fld.label, oninput: sync });
    inputs[key] = inp;
    const chk = h('input', { type: 'checkbox', 'aria-label': `I checked ${fld.label} against the document`, onchange: sync });
    checks[key] = chk;
    const pct = Math.round(fld.confidence * 100);
    const tr = h('tr', {}, h('td', {}, h('b', {}, fld.label), REQUIRED.includes(key) ? h('span', { class: 'req' }, ' *') : null), h('td', {}, inp, key === 'quantity' ? unitSel : null),
      h('td', {}, fld.value === '' ? h('span', { class: 'pill err' }, 'Not found') : h('span', { class: 'conf' }, h('span', { class: 'bar' }, h('i', { style: `width:${pct}%;background:${fld.confidence < LOW ? 'var(--amber)' : 'var(--green)'}` })), `${pct}%`, fld.confidence < LOW ? h('span', { class: 'pill warn' }, 'Check') : null, fld.source === 'ai' ? h('span', { class: 'pill info' }, 'AI suggestion') : null)),
      h('td', { class: 'muted' }, fld.source_ref), h('td', {}, chk));
    tr.fld = fld;
    return tr;
  });
  const need = h('p', { class: 'muted' });
  const confirmBtn = btn('Approve and create record', { kind: 'primary', ic: 'check', disabled: true, onclick: async () => {
    const values = Object.fromEntries(SHOWN.map((k) => [k, inputs[k].value]));
    values.unit = unitSel.value; if (kind === 'electricity') delete values.fuel; else values.fuel = kind === 'transport' ? 'diesel' : kind === 'fuel_other' ? undefined : kind;
    const corrections = {};
    for (const k of SHOWN) if (String(original[k]) !== String(inputs[k].value)) corrections[k] = { from: original[k] === '' ? null : original[k], to: inputs[k].value };
    try { confirmBtn.classList.add('loading'); put(errBox); await submitDone(await api('POST', orgUrl(`/documents/${d.id}/confirm`), { kind, facility_id: facility.value, values, corrections, label: `${TYPE_LABEL[d.doc_type]} ${values.period_start ?? ''}`.trim() })); } catch (e) { confirmBtn.classList.remove('loading'); fail(e); }
  } });
  function sync() {
    let remaining = 0;
    for (const tr of rows) {
      const k = tr.fld.key; const edited = String(original[k]) !== String(inputs[k].value);
      const filled = inputs[k].value !== '';
      const mustCheck = filled && (REQUIRED.includes(k) || tr.fld.confidence < LOW || edited);
      tr.classList.toggle('lowconf', filled && tr.fld.confidence < LOW && !checks[k].checked);
      checks[k].disabled = !filled;
      if (!filled) checks[k].checked = false;
      if (mustCheck && !checks[k].checked) remaining++;
      if (REQUIRED.includes(k) && !filled) remaining++;
    }
    confirmBtn.disabled = remaining > 0;
    need.textContent = remaining ? `${remaining} item(s) still need a value or your confirmation before this can be approved.` : 'All values checked. You can approve.';
  }
  put(root, back, head, note, h('div', { class: 'review' }, previewPane, h('div', { class: 'card' }, h('h3', {}, 'Review extracted information'),
    h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:12px' }, formField('This document records', kindSel), formField('Facility', facility)),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Field', 'Value (editable)', 'Confidence', 'Source reference', 'I checked it'].map((x) => h('th', {}, x)))), h('tbody', {}, rows))),
    need, errBox, h('div', { class: 'row' }, confirmBtn, reject, aiReady() && d.extraction.has_text ? btn('Suggest missing values with AI', { ic: 'bolt', onclick: async (e) => {
      const b = e.currentTarget; b.classList.add('loading');
      try { const r = await api('POST', orgUrl(`/ai/extract/${d.id}`), {}); await refreshAll(); toast(r.added ? `AI added ${r.added} suggestion(s). Check each one against the document.` : 'AI found nothing new in the text.'); go(`documents/${d.id}`, true); }
      catch (err) { b.classList.remove('loading'); toast(err.message, 'err'); }
    } }) : null), aiReady() && !d.extraction.has_text ? h('p', { class: 'muted' }, 'AI can only read text, and this document has none (scanned or photo). Type the values from the original.') : null)));
  sync();
}
