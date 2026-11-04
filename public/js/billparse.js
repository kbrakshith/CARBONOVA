// Suggests values from pasted bill text. This is NOT OCR and not a source of truth: it only proposes
// candidates with a stated confidence, and the person must confirm each one before it is used.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const num = (s) => Number(String(s).replace(/,/g, ''));

export function parseDates(text) {
  const found = [];
  const re = /\b(\d{1,2})[\/\-.](\d{1,2}|[A-Za-z]{3})[\/\-.](\d{4})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const d = Number(m[1]);
    const mo = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].toLowerCase()];
    const y = Number(m[3]);
    if (!mo || mo > 12 || d < 1 || d > 31) continue;
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    if (!Number.isNaN(Date.parse(iso))) found.push({ iso, index: m.index });
  }
  return found;
}

export function parseBillText(text) {
  const out = { kwh: [], dates: [], notes: [] };
  const kw = /(units?\s*(?:consumed|billed)|consumption|total\s*units|energy\s*consumed|net\s*units)[^0-9\n]{0,40}([\d,]+(?:\.\d+)?)/gi;
  let m;
  while ((m = kw.exec(text))) out.kwh.push({ value: num(m[2]), confidence: 0.8, why: `after "${m[1].trim()}"` });
  if (!out.kwh.length) {
    const loose = /([\d,]+(?:\.\d+)?)\s*kwh\b/gi;
    while ((m = loose.exec(text))) out.kwh.push({ value: num(m[1]), confidence: 0.5, why: 'number followed by kWh' });
  }
  out.kwh = out.kwh.filter((k) => Number.isFinite(k.value) && k.value > 0);
  // An explicit "Billing period: <date> to <date>" beats guessing from every date on the page (bill date, due date...).
  const D = '(\\d{1,2}[\\/\\-.][\\dA-Za-z]{1,3}[\\/\\-.]\\d{4})';
  const range = new RegExp(`(?:billing\\s*period|bill\\s*period|period|from)\\s*[:\\-]?\\s*${D}\\s*(?:to|till|until|-|\u2013)\\s*${D}`, 'i').exec(text);
  const pr = range ? [parseDates(range[1])[0]?.iso, parseDates(range[2])[0]?.iso] : null;
  const dates = parseDates(text).map((d) => d.iso);
  const uniq = [...new Set(dates)].sort();
  if (pr && pr[0] && pr[1] && pr[0] <= pr[1]) { out.dates = [{ start: pr[0], end: pr[1], confidence: 0.85, why: 'read from "billing period" range' }]; }
  else if (uniq.length >= 2) { out.dates = [{ start: uniq[0], end: uniq[uniq.length - 1], confidence: uniq.length === 2 ? 0.7 : 0.45, why: `${uniq.length} dates found; earliest and latest used` }]; }
  else if (uniq.length === 1) out.notes.push('Only one date found: enter the billing period manually.');
  if (out.kwh.length > 1) out.notes.push('Several candidate readings found (current, previous, arrears?): pick the units consumed in this billing period.');
  if (!out.kwh.length) out.notes.push('No kWh figure recognised.');
  return out;
}
