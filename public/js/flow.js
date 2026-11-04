import { h, svg, fmt, fmtT } from './dom.js';

/**
 * Mass-flow diagram of an industry's stages: each column is one stage, split into the product that moves on
 * (green ribbon into the next stage), waste streams (amber, hazardous red) and the balancing item (gases, moisture).
 * Heights are proportional to tonnes. Dashed outline = benchmark-estimated; small dashed box = measurement required.
 */
export function stageFlow(chain, { onSelect, selected } = {}) {
  const stages = chain.stages;
  const colW = 92, gap = 118, padX = 16, top = 62, H = 280;
  const W = padX * 2 + stages.length * colW + (stages.length - 1) * gap;
  const total = (s) => s.mass_balance.inputs_t ?? ((s.product_t ?? 0) + s.waste_t);
  const max = Math.max(...stages.map(total), 1e-9);
  const sc = (t) => (t / max) * H;
  const xOf = (i) => padX + i * (colW + gap);

  const defs = svg('defs', {},
    svg('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, svg('rect', { width: 6, height: 6, fill: 'var(--c-gas)' }), svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--card)', 'stroke-width': 2 })));

  const parts = [defs];
  const bars = [];
  const ribbons = [];
  stages.forEach((s, i) => {
    const x = xOf(i);
    const known = s.product_t != null;
    parts.push(svg('text', { x: x + colW / 2, y: 18, 'text-anchor': 'middle', class: 'fl-t' }, shortName(s.name)),
      svg('text', { x: x + colW / 2, y: 34, 'text-anchor': 'middle', class: 'fl-s' }, known ? `${fmtT(total(s))} t in` : 'no data'));
    if (!known) { bars.push(svg('rect', { x, y: top, width: colW, height: 40, fill: 'none', stroke: 'var(--muted)', 'stroke-dasharray': '4 3', rx: 4 })); return; }

    let y = top;
    const seg = (t, cls, fill, title, key, dashed) => {
      const hh = Math.max(sc(t), t > 0 ? 3.5 : 0);
      const isSel = selected && key && selected === key;
      const r = svg('rect', { x, y, width: colW, height: hh, fill, class: `fl-seg grow ${cls}${isSel ? ' sel' : ''}`, style: `animation-delay:${i * 120}ms`, tabindex: key ? 0 : null, role: key ? 'button' : null, 'aria-label': title,
        'stroke-dasharray': dashed ? '5 3' : null, stroke: dashed ? 'var(--fg)' : null, 'stroke-width': dashed ? 1.2 : null,
        onclick: key && onSelect ? () => onSelect(key) : null, onkeydown: key && onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(key); } } : null }, svg('title', {}, title));
      y += hh;
      return r;
    };
    const prodY = y;
    bars.push(seg(s.product_t, 'prod', 'var(--c-prod)', `${s.product}: ${fmt(s.product_t, 1)} t`, null, false));
    const prodH = Math.max(sc(s.product_t), 3.5);
    const wastes = s.streams.filter((x) => typeof x.tonnes === 'number' && x.tonnes > 0).sort((a, b) => Number(b.hazardous) - Number(a.hazardous) || b.tonnes - a.tonnes);
    for (const w of wastes) bars.push(seg(w.tonnes, w.hazardous ? 'haz' : 'waste', w.hazardous ? 'var(--c-haz)' : 'var(--c-waste)', `${w.label}: ${fmt(w.tonnes, 1)} t${w.hazardous ? ' (hazardous)' : ''}${w.basis === 'estimated_benchmark' ? ' - estimated' : ''}`, `${s.id}/${w.stream_id}`, w.basis !== 'measured'));
    const bal = (s.mass_balance.unexplained_t ?? 0);
    if (bal > 0) bars.push(seg(bal, 'gas', 'url(#hatch)', `Gases, moisture, unmeasured: ${fmt(bal, 1)} t`, null, false));
    // measurement-required streams: small dashed boxes below the bar
    s.streams.filter((x) => x.tonnes == null).forEach((w) => {
      bars.push(svg('rect', { x, y: y + 6, width: colW, height: 12, fill: 'none', stroke: 'var(--c-haz)', 'stroke-dasharray': '3 3', rx: 3, class: 'need', tabindex: 0, role: 'button', 'aria-label': `${w.label}: measurement required`,
        onclick: onSelect ? () => onSelect(`${s.id}/${w.stream_id}`) : null }, svg('title', {}, `${w.label}: measurement required`)));
      y += 16;
    });

    if (i < stages.length - 1 && stages[i + 1].chain_input.tonnes != null) {
      const nx = xOf(i + 1), hh2 = Math.max(sc(stages[i + 1].chain_input.tonnes), 3.5), x1 = x + colW, mid = (x1 + nx) / 2;
      ribbons.push(svg('path', { d: `M${x1},${prodY} C${mid},${prodY} ${mid},${top} ${nx},${top} L${nx},${top + hh2} C${mid},${top + hh2} ${mid},${prodY + prodH} ${x1},${prodY + prodH} Z`, fill: 'var(--c-prod)', opacity: 0.28, class: 'ribbon' }));
    }
  });

  const last = stages.at(-1);
  const out = last.product_t != null ? svg('text', { x: W - padX, y: top + H + 40, 'text-anchor': 'end', class: 'fl-s' }, `${fmt(last.product_t, 0)} t ${last.product.toLowerCase()}`) : null;
  return h('div', { class: 'flow-wrap' },
    svg('svg', { viewBox: `0 0 ${W} ${top + H + 56}`, class: 'flow', style: `min-width:${Math.min(W, 640)}px`, role: 'group', 'aria-label': `Mass flow through ${stages.length} stages` }, ...parts, ...ribbons, ...bars, out),
    h('div', { class: 'flow-legend' },
      h('span', {}, h('i', { style: 'background:var(--c-prod)' }), 'Product moving on'), h('span', {}, h('i', { style: 'background:var(--c-waste)' }), 'Waste'), h('span', {}, h('i', { style: 'background:var(--c-haz)' }), 'Hazardous waste'),
      h('span', {}, h('i', { class: 'hatch' }), 'Gases, moisture, unmeasured'), h('span', {}, h('i', { class: 'dash' }), 'Dashed = estimated from benchmark / needs measuring')));
}

const shortName = (n) => n.replace(/\(.*\)/, '').trim().split(/\s+/).slice(0, 2).join(' ');
