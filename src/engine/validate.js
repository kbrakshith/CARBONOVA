// Input validation: boundary, reporting period, duplicates, overlap, evidence quality.
// Errors block issuing a report; warnings must be acknowledged; nothing is silently corrected.

const ACTIVITY_TYPES = ['electricity', 'fuel', 'refrigerant', 'process_emission'];
const MIN_OCR_CONFIDENCE = 0.9;
const MAX_BILL_DAYS = 62;

export const isoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;

/** Indian financial year helpers (1 April - 31 March). */
export function fyBounds(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(fy ?? '');
  if (!m) throw new Error(`Financial year must look like 2026-27, got "${fy}"`);
  const y = Number(m[1]);
  if ((y + 1) % 100 !== Number(m[2])) throw new Error(`Financial year "${fy}" is not consecutive`);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31`, reportingYear: y };
}

export function validateInventory(inv) {
  const errors = [];
  const warnings = [];
  const err = (code, message, ref) => errors.push({ code, message, ref });
  const warn = (code, message, ref) => warnings.push({ code, message, ref });

  const org = inv.organisation ?? {};
  for (const k of ['legal_name', 'industry', 'consolidation_approach']) {
    if (!org[k]) err('BOUNDARY_FIELD', `Organisation boundary: "${k}" is required.`);
  }
  if (org.consolidation_approach && !['operational_control', 'financial_control', 'equity_share'].includes(org.consolidation_approach)) {
    err('BOUNDARY_APPROACH', 'consolidation_approach must be operational_control, financial_control or equity_share.');
  }
  if (!org.facilities?.length) err('BOUNDARY_FACILITIES', 'At least one facility is required.');
  let period;
  try { period = fyBounds(org.reporting_fy); } catch (e) { err('REPORTING_PERIOD', e.message); }

  const seenIds = new Set();
  const seenHashes = new Map();
  const byKey = new Map();
  for (const a of inv.activities ?? []) {
    const ref = a.id;
    if (!a.id) { err('ACTIVITY_ID', 'Every activity needs an id.'); continue; }
    if (seenIds.has(a.id)) { err('ACTIVITY_DUPLICATE_ID', `Duplicate activity id ${a.id}.`, ref); continue; }
    seenIds.add(a.id);
    if (a.voided) continue;
    if (!ACTIVITY_TYPES.includes(a.type)) { err('ACTIVITY_TYPE', `Unknown activity type "${a.type}".`, ref); continue; }
    if (!isoDate(a.period?.start) || !isoDate(a.period?.end) || a.period.start > a.period.end) { err('ACTIVITY_PERIOD', 'Activity needs a valid period {start,end} with start <= end (YYYY-MM-DD).', ref); continue; }
    if (org.facilities?.length && !org.facilities.some((f) => f.id === a.facility_id)) err('ACTIVITY_FACILITY', `Facility "${a.facility_id}" is not in the organisational boundary.`, ref);

    if (period) {
      if (a.period.end < period.start || a.period.start > period.end) err('OUTSIDE_PERIOD', `Activity ${a.period.start}..${a.period.end} is outside reporting year ${org.reporting_fy}.`, ref);
      else if (a.period.start < period.start || a.period.end > period.end) warn('PARTIAL_PERIOD', 'Activity straddles the reporting-year boundary: apportion by days or split the bill.', ref);
    }
    if (a.type === 'electricity' && days(a.period.start, a.period.end) > MAX_BILL_DAYS) warn('LONG_BILL_PERIOD', `Billing period is ${days(a.period.start, a.period.end)} days - check for a merged or estimated bill.`, ref);

    // Electricity billing periods on the same meter must not overlap (double counting). Fuel receipts and refrigerant
    // top-ups are discrete purchases, so several per month are normal; only exact repeats are flagged.
    const key = [a.type, a.facility_id, a.meter_id ?? a.fuel ?? a.refrigerant ?? a.gas, a.use ?? '', a.ownership ?? ''].join('|');
    for (const prev of byKey.get(key) ?? []) {
      if (a.type === 'electricity') {
        if (a.period.start <= prev.period.end && prev.period.start <= a.period.end) err('PERIOD_OVERLAP', `Overlaps activity ${prev.id} for the same ${a.type} stream: possible double counting.`, ref);
      } else if (a.period.start === prev.period.start && a.period.end === prev.period.end && a.quantity === prev.quantity) {
        warn('POSSIBLE_DUPLICATE', `Same stream, period and quantity as ${prev.id}: check this is not a repeated entry.`, ref);
      }
    }
    byKey.set(key, [...(byKey.get(key) ?? []), a]);

    // evidence
    const ev = a.evidence;
    if (!ev?.id) warn('NO_EVIDENCE', 'No evidence attached: figure will be labelled unsupported.', ref);
    if (ev?.hash) {
      if (seenHashes.has(ev.hash)) err('DUPLICATE_EVIDENCE', `Same document already used by ${seenHashes.get(ev.hash)}: re-import would double count.`, ref);
      else seenHashes.set(ev.hash, a.id);
    }
    if (ev?.extraction_confidence != null && ev.extraction_confidence < MIN_OCR_CONFIDENCE && !ev.user_confirmed) {
      warn('LOW_CONFIDENCE_UNCONFIRMED', `Extracted value has confidence ${ev.extraction_confidence} and has not been confirmed by a person.`, ref);
    }
    if (a.data_quality === 'estimated' && !a.estimation_basis) warn('ESTIMATE_NO_BASIS', 'Estimated figure without a stated basis.', ref);

    if (a.type === 'fuel' && a.ownership === 'third_party' && ![4, 6, 7, 9].includes(a.scope3_category)) {
      err('SCOPE3_CATEGORY', 'Third-party fuel needs scope3_category (4 upstream transport, 6 business travel, 7 commuting, 9 downstream transport).', ref);
    }
  }

  if (!inv.organisation?.revenue_inr) warn('NO_REVENUE', 'No turnover given: intensity ratio will not be shown.');
  return { errors, warnings };
}
