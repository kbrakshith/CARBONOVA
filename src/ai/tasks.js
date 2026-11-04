import { chatJson, redact } from './groq.js';
import { httpError } from '../store.js';

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const AI_CONFIDENCE = 0.5; // below the review threshold on purpose: every AI value must be checked by a person

// ---------------------------------------------------------------- 1. document field suggestions
const FIELD_KEYS = {
  electricity_bill: ['period_start', 'period_end', 'quantity', 'meter_id', 'vendor', 'billing_date'],
  fuel_receipt: ['period_start', 'quantity', 'fuel', 'vendor'],
  default: ['period_start', 'period_end', 'quantity', 'vendor'],
};

/** Keep only AI suggestions that quote the document and agree with what they quote. Everything else is dropped. */
export function validateExtraction(docType, text, raw) {
  const keys = FIELD_KEYS[docType] ?? FIELD_KEYS.default;
  const hay = norm(text);
  const out = [];
  for (const f of Array.isArray(raw?.fields) ? raw.fields : []) {
    if (!keys.includes(f?.key) || f.value == null || f.value === '' || typeof f.quote !== 'string') continue;
    const quote = norm(f.quote);
    if (quote.length < 3 || !hay.includes(quote)) continue; // must be a real quotation from the document
    let value = f.value;
    if (f.key === 'quantity') {
      value = Number(String(f.value).replace(/,/g, ''));
      if (!Number.isFinite(value) || value <= 0 || !quote.replace(/,/g, '').includes(String(value))) continue;
    } else if (f.key.startsWith('period') || f.key === 'billing_date') {
      if (!ISO.test(String(value)) || Number.isNaN(Date.parse(value))) continue;
    } else if (f.key === 'fuel') {
      value = String(value).toLowerCase();
      if (!['diesel', 'petrol', 'lpg'].includes(value)) continue;
    } else value = String(value).slice(0, 120);
    out.push({ key: f.key, value, quote: f.quote.slice(0, 160) });
  }
  return out;
}

export async function suggestFields(docType, text) {
  const keys = FIELD_KEYS[docType] ?? FIELD_KEYS.default;
  const raw = await chatJson({
    system: 'You extract fields from the text of Indian utility bills and fuel receipts. Reply with JSON only: {"fields":[{"key":string,"value":string|number,"quote":string}]}. '
      + `Allowed keys: ${keys.join(', ')}. "quote" must be copied exactly from the text and must contain the value. Dates must be ISO YYYY-MM-DD. Quantity is a plain number (kWh for electricity, litres or kg otherwise). `
      + 'If a field is not clearly present, omit it. Never guess, never calculate, never convert units.',
    user: redact(text).slice(0, 6000),
  });
  return validateExtraction(docType, text, raw).map((f) => ({ ...f, confidence: AI_CONFIDENCE, source: 'ai' }));
}

// ---------------------------------------------------------------- 2. activity type suggestion
export const KINDS = ['electricity', 'diesel', 'petrol', 'lpg', 'transport', 'waste', 'refrigerant', 'fuel_other'];
export function validateClassification(raw) {
  const kind = String(raw?.kind ?? '').toLowerCase();
  if (!KINDS.includes(kind)) return null;
  return { kind, reason: String(raw?.reason ?? '').slice(0, 200), confidence: AI_CONFIDENCE, source: 'ai' };
}
export async function classifyActivity(description) {
  const raw = await chatJson({
    system: `Classify an Indian MSME's activity description into exactly one of: ${KINDS.join(', ')}. "transport" means fuel bought for hired or third-party vehicles. `
      + 'Reply with JSON only: {"kind":string,"reason":string}. If unsure choose the closest and say why in "reason".',
    user: redact(description).slice(0, 400), maxTokens: 150,
  });
  const v = validateClassification(raw);
  if (!v) throw httpError(502, 'The AI service gave an answer that does not match any activity type.');
  return v;
}

// ---------------------------------------------------------------- 3. narrative summary (numbers must come from saved results)
const BANNED = /\b(verified|assured|assurance|compliant|compliance|certified|certification|guaranteed|accepted by)\b/i;
export const hasBannedClaim = (text) => BANNED.test(text);
export const allowedNumbers = (facts) => {
  const set = new Set();
  const add = (n) => { if (typeof n === 'number' && Number.isFinite(n)) for (const d of [0, 1, 2, 3]) set.add(Number(Math.abs(n).toFixed(d))); };
  for (const v of Object.values(facts)) { if (typeof v === 'number') add(v); if (Array.isArray(v)) v.forEach((x) => typeof x === 'object' && Object.values(x).forEach(add)); }
  for (const t of String(facts.fy).split('-')) set.add(Number(t));
  set.add(15); // "15 Scope 3 categories"
  return set;
};

/** Reject drafts that contain any number not present in the saved results, or claims the product must never make. */
export function validateNarrative(facts, raw) {
  const text = String(raw?.text ?? '').trim();
  if (text.length < 40) return { ok: false, reason: 'The draft was empty or too short.' };
  if (BANNED.test(text)) return { ok: false, reason: 'The draft made a verification or compliance claim, which this report cannot make.' };
  const allowed = allowedNumbers(facts);
  // Labels that contain digits are not figures: tCO2e, CH4, N2O, "Scope 1/2/3".
  const figures = text.replace(/\bt?CO2e?\b|\bCH4\b|\bN2O\b/gi, ' ').replace(/\bScopes?\s*[123](?:\s*(?:,|and|&|\/)\s*[123])*/gi, ' ');
  for (const m of figures.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!allowed.has(n)) return { ok: false, reason: `The draft contained a number (${m[0]}) that is not in your saved results.` };
  }
  return { ok: true, text };
}
export async function draftNarrative(facts) {
  const raw = await chatJson({
    system: 'You write a short, plain-English summary (3 to 5 sentences) of a small business carbon report for a customer. Use ONLY the numbers in the provided JSON, exactly as given. '
      + 'Do not calculate, round differently, compare to other companies, or claim verification, assurance, compliance or certification. Say Scope 3 is a partial inventory. Reply with JSON only: {"text":string}.',
    user: JSON.stringify(facts), maxTokens: 400,
  });
  const v = validateNarrative(facts, raw);
  if (!v.ok) throw httpError(422, `AI draft rejected: ${v.reason} Write the summary yourself or try again.`);
  return v.text;
}
