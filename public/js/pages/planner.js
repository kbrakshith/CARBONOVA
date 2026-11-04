import { h, put, icon, toast, fmt, debounce } from '../dom.js';
import { btn, tabs, status, emptyState, formField, select, t, demoBanner } from '../ui.js';
import { S, api, recompute } from '../state.js';
import { orgUrl } from '../session.js';
import { barChart, COL } from '../chartjs.js';
import { render as renderScenarios } from './whatif.js';

const ASSUME = [['tariff_inr_per_kwh', 'Electricity rate (INR/kWh)'], ['solar_cost_inr_per_kwp', 'Solar cost (INR/kWp)'], ['solar_yield_kwh_per_kwp_yr', 'Solar yield (kWh/kWp/yr)'], ['diesel_inr_per_l', 'Diesel price (INR/L)'], ['led_lighting_share', 'Lighting share of electricity (0-1)'], ['led_saving_fraction', 'LED saving on lighting (0-1)']];
const STATUS_OPTS = [['saved', 'Saved'], ['planned', 'Planned'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['dismissed', 'Dismissed']];
const TABS = [['recs', 'Opportunities'], ['plan', 'My plan'], ['scenarios', 'What-if scenarios']];

export async function render(root, go, query = {}) {
  const body = h('div');
  const active = TABS.some(([k]) => k === query.tab) ? query.tab : 'recs';
  let recs = null;
  let tracked = (await api('GET', orgUrl('/actions'))).actions;
  const A = {};

  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Reduction planner'), h('p', { class: 'sub' }, 'Actions drawn from your own emissions profile. Track them from idea to done.'))), S.app.demo ? demoBanner() : null,
    tabs(TABS, active, (k) => { history.replaceState(null, '', `#planner?tab=${k}`); draw(k); }), body);

  const track = async (rec, statusKey, extra = {}) => {
    const r = await api('PUT', orgUrl(`/actions/${rec.id ?? rec.rec_id}`), { status: statusKey, title: rec.title, est_tco2e: rec.annual_tco2e_avoided ?? rec.est_tco2e, est_saving_inr: rec.annual_saving_inr ?? rec.est_saving_inr, ...extra });
    tracked = (await api('GET', orgUrl('/actions'))).actions;
    toast(statusKey === 'saved' ? 'Saved to your plan.' : `Marked ${STATUS_OPTS.find(([k]) => k === statusKey)[1].toLowerCase()}.`);
    return r;
  };

  async function loadRecs() { recs = await api('POST', orgUrl('/recommendations'), { assumptions: A }); }

  function card(a) {
    const tr = tracked.find((x) => x.rec_id === a.id);
    const ctl = tr ? select(STATUS_OPTS, tr.status, { 'aria-label': `Status for ${a.title}`, onchange: async (e) => { await track(a, e.target.value); draw('recs'); } }) : btn('Save to plan', { ic: 'plus', onclick: async () => { await track(a, 'saved'); draw('recs'); } });
    const m = (v, l, sub) => h('div', { class: 'metric', style: 'border:0;padding:8px 14px 8px 0' }, h('span', { class: 'm-l' }, l), h('b', { style: 'font-size:17px', class: 'm-v' }, v), sub ? h('span', { class: 'm-s' }, sub) : null);
    return h('article', { class: 'card' },
      h('div', { class: 'between' }, h('div', { style: 'flex:1;min-width:240px' }, h('h3', {}, a.title), h('p', { class: 'muted' }, a.why), h('p', {}, a.detail)), h('div', { class: 'row-tight' }, tr ? status(tr.status) : null, ctl)),
      h('div', { class: 'row-tight', style: 'flex-wrap:wrap;margin-top:6px' },
        m(a.annual_tco2e_avoided > 0 ? `${t(a.annual_tco2e_avoided)} tCO₂e` : a.diverted_t ? `${t(a.diverted_t)} t` : 'Not calculable', a.annual_tco2e_avoided > 0 ? 'Avoided per year' : a.diverted_t ? 'Diverted from disposal' : 'Emissions effect', a.range_tco2e ? `range ${t(a.range_tco2e[0])} to ${t(a.range_tco2e[1])}` : null),
        m(a.upfront_inr != null ? `₹${fmt(a.upfront_inr, 0)}` : 'Get a quote', 'Estimated investment'), m(a.annual_saving_inr != null ? `₹${fmt(a.annual_saving_inr, 0)}` : '-', 'Potential annual saving'),
        m(a.payback_years != null ? `${fmt(a.payback_years, 1)} years` : '-', 'Payback'), m(a.effort, 'Effort required'), m(a.confidence, 'Confidence')),
      h('details', {}, h('summary', { class: 'muted' }, 'Assumptions behind these numbers'), Object.keys(a.assumptions).length ? h('div', {}, Object.entries(a.assumptions).map(([k, v]) => h('span', { class: 'badge est' }, `${k.replace(/_/g, ' ')}: ${v}`)), h('p', { class: 'muted' }, 'Illustrative values. Replace them with your own tariff, quotes and audit results above.')) : h('p', { class: 'muted' }, 'Based on your recorded tonnages and routes; no money assumptions.')));
  }

  async function recsTab() {
    if (!recs) await loadRecs();
    const reload = debounce(async () => { await loadRecs(); draw('recs'); }, 400);
    const ass = h('details', { class: 'card' }, h('summary', {}, 'Edit assumptions'), h('p', { class: 'muted' }, 'Savings and costs come only from these values. They start as illustrative placeholders: replace them with your own electricity rate, supplier quotes and audit findings.'),
      h('div', { class: 'grid' }, ASSUME.map(([k, l]) => { const i = h('input', { type: 'number', step: 'any', min: '0', value: recs.assumptions[k], oninput: (e) => { A[k] = Number(e.target.value); reload(); } }); return formField(l, i); })));
    return h('div', {}, h('div', { class: 'banner warn' }, icon('alert', 16), h('span', {}, recs.note)), ass,
      recs.actions.length ? recs.actions.map(card) : h('div', { class: 'card' }, emptyState({ icon: 'leaf', title: 'No opportunities found yet', body: 'Add electricity, fuel or waste records and relevant actions appear here.', action: btn('Add records', { kind: 'primary', onclick: () => go('records') }) })));
  }

  function planTab() {
    const counts = Object.fromEntries(STATUS_OPTS.map(([k]) => [k, tracked.filter((x) => x.status === k).length]));
    const live = tracked.filter((x) => x.status !== 'dismissed');
    const sum = (st) => tracked.filter((x) => x.status === st).reduce((s, x) => s + (x.est_tco2e ?? 0), 0);
    const pct = live.length ? counts.completed / live.length : 0;
    const cmp = S.summary.comparison;
    const row = (x) => h('div', { class: 'card' }, h('div', { class: 'between' }, h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, x.title), h('p', { class: 'muted' }, `Saved ${new Date(x.saved_at).toLocaleDateString('en-IN')} · baseline FY ${x.baseline_fy}${x.est_tco2e ? ` · estimated ${t(x.est_tco2e)} tCO₂e/yr` : ''}`)),
      h('div', { class: 'row-tight' }, status(x.status), select(STATUS_OPTS, x.status, { 'aria-label': `Status for ${x.title}`, onchange: async (e) => { await track(x, e.target.value); draw('plan'); } }))),
      h('div', { class: 'field' }, h('label', {}, 'Notes'), h('textarea', { rows: 2, placeholder: 'Owner, quote reference, next step...', onchange: async (e) => { await track(x, x.status, { notes: e.target.value }); } }, x.notes ?? '')),
      h('details', {}, h('summary', { class: 'muted' }, 'History'), h('ul', { class: 'list' }, x.history.slice().reverse().map((e) => h('li', {}, h('span', { class: 'dotmark ok' }), h('div', {}, `${e.from ? STATUS_OPTS.find(([k]) => k === e.from)?.[1] : 'Created'} → ${STATUS_OPTS.find(([k]) => k === e.to)[1]}`, h('div', { class: 'muted' }, new Date(e.at).toLocaleString('en-IN'))))))));
    return h('div', {},
      h('div', { class: 'metrics' }, ...[['Saved', counts.saved], ['Planned', counts.planned], ['In progress', counts.in_progress], ['Completed', counts.completed]].map(([l, v]) => h('div', { class: 'metric' }, h('span', { class: 'm-l' }, l), h('b', { class: 'm-v' }, String(v))))),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Progress'), h('span', { class: 'muted' }, `${Math.round(pct * 100)}% of tracked actions completed`)), h('div', { class: 'progress' }, h('i', { style: `width:${pct * 100}%` })),
        h('p', { class: 'chart-sum' }, `Estimated annual reduction once delivered: ${t(sum('completed'))} tCO₂e completed, ${t(sum('in_progress'))} in progress, ${t(sum('planned'))} planned. These are planning estimates from the assumptions, not measured results.`)),
      cmp ? h('div', { class: 'card' }, h('h3', {}, 'Baseline and later period'), barChart([{ label: `Same months FY ${S.summary.previous_fy}`, value: cmp.previous_t, color: COL.prev }, { label: `Months so far FY ${S.fy}`, value: cmp.current_t, color: COL.s1 }], { unit: 'tCO₂e' }),
        h('p', { class: 'chart-sum' }, `Like-for-like months from bills and fuel records: ${t(cmp.previous_t)} → ${t(cmp.current_t)} tCO₂e (${cmp.change_pct <= 0 ? 'down' : 'up'} ${fmt(Math.abs(cmp.change_pct), 1)}%). Activity changes, weather and production volume also move this figure, so it is not proof that an action worked.`)) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'A comparison appears once a second financial year has records.')),
      live.length ? live.map(row) : h('div', { class: 'card' }, emptyState({ icon: 'target', title: 'Your plan is empty', body: 'Save an opportunity to start tracking it.', action: btn('See opportunities', { kind: 'primary', onclick: () => { history.replaceState(null, '', '#planner?tab=recs'); draw('recs'); } }) })),
      tracked.some((x) => x.status === 'dismissed') ? h('p', { class: 'muted' }, `${counts.dismissed} dismissed action(s) hidden.`) : null);
  }

  async function draw(k) {
    put(body, h('p', { class: 'muted' }, 'Loading...'));
    if (k === 'recs') put(body, await recsTab());
    else if (k === 'plan') put(body, planTab());
    else { put(body); if (!S.out) await recompute(); await renderScenarios(body, go); }
  }
  await draw(active);
}
