import { BRSR_CATEGORIES, ROUTES } from './taxonomy.js';

/**
 * BRSR Principle 6 waste table (tonnes). For each of the eight waste categories:
 *   generated, recovered {recycled, reused, other_recovery}, disposed {incineration, landfill, other_disposal}
 * Built ONLY from lines with a measured/estimated tonnage. Streams still needing measurement are counted
 * separately so the table is never presented as complete when it is not.
 */
export function brsrWasteTable(wasteLines) {
  const table = {};
  for (const k of Object.keys(BRSR_CATEGORIES)) {
    table[k] = { label: BRSR_CATEGORIES[k], generated: 0, recycled: 0, reused: 0, other_recovery: 0, incineration: 0, landfill: 0, other_disposal: 0 };
  }
  let unmeasured = 0;
  let estimated = 0;
  for (const l of wasteLines) {
    if (typeof l.tonnes !== 'number') { unmeasured++; continue; }
    const row = table[l.brsr];
    if (!row) throw new Error(`Unknown BRSR category "${l.brsr}"`);
    row.generated += l.tonnes;
    if (l.basis !== 'measured') estimated += l.tonnes;
    for (const sp of l.splits) row[ROUTES[sp.route].brsr] += sp.tonnes;
  }
  const rows = Object.entries(table).map(([key, r]) => ({ key, ...r }));
  const total = rows.reduce((acc, r) => {
    for (const f of ['generated', 'recycled', 'reused', 'other_recovery', 'incineration', 'landfill', 'other_disposal']) acc[f] += r[f];
    return acc;
  }, { generated: 0, recycled: 0, reused: 0, other_recovery: 0, incineration: 0, landfill: 0, other_disposal: 0 });
  const recovered = total.recycled + total.reused + total.other_recovery;
  const disposed = total.incineration + total.landfill + total.other_disposal;
  return {
    rows, total,
    recovered_t: recovered, disposed_t: disposed,
    recovery_rate: total.generated ? recovered / total.generated : null,
    unreconciled_t: total.generated - recovered - disposed,
    estimated_t: estimated,
    streams_without_quantity: unmeasured,
    complete: unmeasured === 0,
  };
}
