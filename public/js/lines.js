import { S, api } from './state.js';
import { orgUrl } from './session.js';
import { openCalc } from './calcdetail.js';
import { toast } from './dom.js';

const fyOf = (iso) => { const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };

/** Find the calculation line(s) behind a record, loading that record's financial year if needed. */
export async function linesForRecord(rec) {
  const fy = fyOf(rec.period.start);
  const sum = fy === S.fy ? S.summary : await api('POST', orgUrl('/summary'), { fy });
  const lines = sum.current?.result.lines ?? [];
  return rec.kind === 'waste' ? lines.filter((l) => l.activity_id.startsWith(`waste:general/${rec.id}/`)) : lines.filter((l) => l.activity_id === rec.id);
}

export async function openCalcForRecord(rec) {
  const ls = await linesForRecord(rec);
  if (!ls.length) { toast(rec.review_status === 'needs_review' ? 'This record is pending review, so it is not calculated yet.' : 'No calculation for this record yet (for example, recycling routes carry no treatment emissions).'); return; }
  openCalc(ls[0]);
}
