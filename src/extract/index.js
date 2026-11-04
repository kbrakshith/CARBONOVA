import { inflateSync } from 'node:zlib';
import { parseBillText, parseDates } from '../../public/js/billparse.js';

/**
 * Document extraction.  This is a RULE-BASED TEXT EXTRACTOR, not OCR and not an LLM:
 *   - PDFs with an embedded text layer: text is read and matched with patterns.
 *   - CSV: parsed row by row and validated.
 *   - Scanned PDFs and photos: no text can be read here, so every field is returned empty for manual entry.
 * Everything returned is a SUGGESTION with a confidence and a source reference; nothing is auto-approved.
 */
export const SERVICE = 'rule-based text extractor (not OCR, not AI)';
export const DOC_TYPES = {
  electricity_bill: 'Electricity bill', fuel_receipt: 'Fuel receipt', purchase_invoice: 'Purchase invoice',
  transport_receipt: 'Transport receipt', waste_record: 'Waste record', csv: 'CSV file',
};
export const LOW_CONFIDENCE = 0.75;

export function detectKind(buf, name = '') {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (/\.csv$/i.test(name) && !buf.subarray(0, 2000).includes(0)) return 'csv';
  return null;
}
export const MIME_OF = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', csv: 'text/csv' };

function unescapePdf(s) {
  return s.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c)).replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

export function pdfText(buf) {
  const raw = buf.toString('latin1');
  const chunks = [raw];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const end = raw.indexOf('endstream', re.lastIndex);
    if (end < 0) break;
    const body = Buffer.from(raw.slice(re.lastIndex, end), 'latin1');
    try { chunks.push(inflateSync(body).toString('latin1')); } catch { /* not a Flate stream */ }
  }
  const lines = [];
  for (const c of chunks) {
    for (const t of c.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) lines.push(unescapePdf(t[1]));
    for (const arr of c.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      lines.push([...arr[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => unescapePdf(x[1])).join(''));
    }
  }
  return lines.map((l) => l.trim()).filter(Boolean).join('\n');
}

const FUELS = [['diesel', /diesel|hsd/i], ['petrol', /petrol|motor spirit|\bms\b/i], ['lpg', /\blpg\b|cylinder/i]];

function field(key, label, value, confidence, source_ref, unit) {
  return { key, label, value: value ?? '', unit: unit ?? null, confidence: value == null || value === '' ? 0 : confidence, source_ref: value == null || value === '' ? 'not found in document' : source_ref };
}

export function extractFields(docType, text) {
  const out = [];
  const dates = parseDates(text).map((d) => d.iso);
  const uniq = [...new Set(dates)].sort();
  const vendor = (text.split('\n').find((l) => /(discom|electricity|power|board|petroleum|fuels?|transport|logistics|traders|pvt|ltd|limited|gas)/i.test(l)) ?? '').trim();
  if (docType === 'electricity_bill') {
    const b = parseBillText(text);
    const k = b.kwh[0];
    const meter = /(?:consumer|service connection|meter)\s*(?:no\.?|number|id)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i.exec(text);
    const billDate = /bill\s*date\s*[:\-]?\s*(\d{1,2}[\/\-.][\dA-Za-z]{1,3}[\/\-.]\d{4})/i.exec(text);
    out.push(field('vendor', 'Consumer / vendor name', vendor, 0.6, `line "${vendor.slice(0, 40)}"`),
      field('period_start', 'Billing period start', b.dates[0]?.start, b.dates[0]?.confidence ?? 0, b.dates[0]?.why),
      field('period_end', 'Billing period end', b.dates[0]?.end, b.dates[0]?.confidence ?? 0, b.dates[0]?.why),
      field('quantity', 'Electricity consumption', k?.value, k?.confidence ?? 0, k?.why, 'kWh'),
      field('billing_date', 'Billing date', billDate ? parseDates(billDate[1])[0]?.iso : '', 0.7, 'text after "bill date"'),
      field('meter_id', 'Meter / consumer number', meter?.[1], 0.65, `text "${meter?.[0]?.slice(0, 40)}"`));
  } else {
    const qty = /(\d[\d,]*(?:\.\d+)?)\s*(litres?|ltrs?|liters?|kg|kgs|tonnes?|tons?|kwh|\bl\b)/i.exec(text);
    const fuel = FUELS.find(([, re]) => re.test(text))?.[0];
    const unitMap = { litre: 'L', litres: 'L', ltr: 'L', ltrs: 'L', liter: 'L', liters: 'L', l: 'L', kg: 'kg', kgs: 'kg', tonne: 't', tonnes: 't', ton: 't', tons: 't', kwh: 'kWh' };
    out.push(field('vendor', 'Vendor name', vendor, 0.6, `line "${vendor.slice(0, 40)}"`),
      field('period_start', 'Date / period start', uniq[0], uniq.length ? 0.7 : 0, 'first date in document'),
      field('period_end', 'Period end', uniq.at(-1), uniq.length ? 0.7 : 0, 'last date in document'),
      field('quantity', 'Quantity', qty ? Number(qty[1].replace(/,/g, '')) : '', qty ? 0.7 : 0, `text "${qty?.[0]}"`, qty ? unitMap[qty[2].toLowerCase()] ?? null : null));
    if (docType === 'fuel_receipt') out.push(field('fuel', 'Fuel type', fuel, 0.7, 'keyword in document'));
  }
  return out;
}

export function parseCsv(text) {
  const rows = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (rows.length < 2) return { rows: [], problems: ['CSV needs a header row and at least one data row.'] };
  const head = rows[0].split(',').map((h) => h.trim().toLowerCase());
  const need = ['type', 'start', 'end', 'quantity', 'unit'];
  const missing = need.filter((n) => !head.includes(n));
  if (missing.length) return { rows: [], problems: [`Missing column(s): ${missing.join(', ')}. Expected: type,start,end,quantity,unit[,fuel,use,meter]`] };
  const out = [];
  const problems = [];
  rows.slice(1).forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const r = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? '']));
    const errs = [];
    if (!['electricity', 'fuel'].includes(r.type)) errs.push('type must be electricity or fuel');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start) || !/^\d{4}-\d{2}-\d{2}$/.test(r.end)) errs.push('dates must be YYYY-MM-DD');
    const q = Number(r.quantity);
    if (!Number.isFinite(q) || q < 0 || r.quantity === '') errs.push('quantity must be a number >= 0');
    if (r.type === 'fuel' && !r.fuel) errs.push('fuel is required');
    out.push({ line: i + 2, ...r, quantity: q, errors: errs });
    if (errs.length) problems.push(`Row ${i + 2}: ${errs.join('; ')}`);
  });
  return { rows: out, problems };
}

export function extractDocument(buf, { docType, name }) {
  const kind = detectKind(buf, name);
  if (!kind) return { kind: null };
  if (kind === 'csv') {
    const { rows, problems } = parseCsv(buf.toString('utf8'));
    return { kind, service: 'CSV parser', fields: [], rows, notes: problems };
  }
  if (kind === 'pdf') {
    const text = pdfText(buf);
    if (!text) return { kind, service: SERVICE, fields: extractFields(docType, ''), rows: [], text: '', notes: ['No readable text layer (scanned PDF). OCR is not available in this prototype: enter the values from the document by hand.'] };
    return { kind, service: SERVICE, fields: extractFields(docType, text), rows: [], text, notes: ['Values are suggestions from text patterns. Check each against the document.'] };
  }
  return { kind, service: SERVICE, fields: extractFields(docType, ''), rows: [], text: '', notes: ['Photos cannot be read here (no OCR in this prototype). Enter the values from the image by hand.'] };
}

/** Minimal text-layer PDF writer used for demo documents so previews and extraction are real. */
export function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 12 Tf 50 780 Td 16 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join('\n')}\nET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
