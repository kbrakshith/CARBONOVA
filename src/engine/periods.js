import { fyBounds } from './validate.js';

export const fyOf = (iso) => {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
};
export const prevFy = (fy) => { const y = Number(fy.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };

export function availableFys(inv) {
  const set = new Set([inv.organisation.reporting_fy]);
  for (const a of inv.activities ?? []) if (!a.voided && a.period?.start) set.add(fyOf(a.period.start));
  for (const g of inv.waste?.general_waste ?? []) if (!g.voided && g.period?.start) set.add(fyOf(g.period.start));
  return [...set].sort().reverse();
}

/**
 * The inventory as it stands for one financial year. Activities belong to the FY their period starts in.
 * The stage-wise (process chain) waste data belongs to the organisation's current reporting year only;
 * other years carry only dated site-wide waste records.
 */
export function inventoryForFy(inv, fy) {
  const { start, end } = fyBounds(fy);
  const copy = structuredClone(inv);
  copy.organisation.reporting_fy = fy;
  copy.activities = (copy.activities ?? []).filter((a) => a.period && a.period.start >= start && a.period.start <= end);
  const isCurrent = fy === inv.organisation.reporting_fy;
  if (copy.waste) {
    const general = (copy.waste.general_waste ?? []).filter((g) => (g.period?.start ? g.period.start >= start && g.period.start <= end : isCurrent));
    copy.waste = isCurrent ? { ...copy.waste, general_waste: general } : { stages: {}, general_waste: general, disposal_site: copy.waste.disposal_site };
  }
  return copy;
}

export const monthKeysOfFy = (fy) => {
  const y = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; return `${m >= 4 ? y : y + 1}-${String(m).padStart(2, '0')}`; });
};

/** Source bucket for dashboards. */
export function sourceOf(line) {
  if (line.type === 'electricity') return 'Electricity';
  if (line.type === 'refrigerant') return 'Refrigerants';
  if (line.type === 'waste') return 'Waste';
  if (line.type === 'process_emission') return 'Process';
  if (line.type === 'fuel') {
    if (line.scope === 3) return 'Transport';
    return { diesel: 'Diesel', petrol: 'Petrol', lpg: 'LPG' }[line.fuel] ?? 'Other fuels';
  }
  return 'Other';
}
