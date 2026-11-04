import { getIndustry, INDUSTRIES } from './industries.js';
import { WASTE_CLASSES, ROUTES, REGULATIONS } from './taxonomy.js';

/**
 * Which wastes does this industry generate, and where? Used by the UI wizard (pick industry -> see each
 * stage's expected streams) and by validation (is a declared stream plausible for this industry?).
 */
export function expectedStreams(industryId, stageId) {
  const profile = getIndustry(industryId);
  const stages = stageId ? profile.stages.filter((s) => s.id === stageId) : profile.stages;
  return stages.flatMap((s) => s.wastes.map((w) => describeStream(s, w)));
}

function describeStream(stage, w) {
  const cls = WASTE_CLASSES[w.waste_class];
  return {
    stage: stage.id, stage_name: stage.name, stream_id: w.id, label: w.label,
    waste_class: w.waste_class, class_label: cls.label, hazardous: cls.hazardous,
    brsr: w.brsr ?? cls.brsr, hvle: !!w.hvle, benchmark: w.per_t ?? null, default_route: w.default_route,
    regulations: (w.regs ?? []).map((k) => ({ key: k, name: REGULATIONS[k].name, verified: REGULATIONS[k].verified })),
    reg_item: w.reg_item ?? null, ref_confidence: w.ref_confidence ?? null, note: w.note ?? null,
  };
}

/** Keyword-assisted lookup: "I have spent pot lining / dross / sludge" -> candidate streams across industries. */
export function identifyByText(text, industryId) {
  const q = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!q.length) return [];
  const pool = industryId ? [[industryId, getIndustry(industryId)]] : Object.entries(INDUSTRIES);
  const hits = [];
  for (const [id, p] of pool) {
    for (const s of p.stages) {
      for (const w of s.wastes) {
        const hay = `${w.label} ${w.id} ${w.note ?? ''}`.toLowerCase();
        const score = q.filter((t) => hay.includes(t)).length;
        if (score) hits.push({ score, industry: id, ...describeStream(s, w) });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 10);
}

/**
 * Validate the waste a unit has DECLARED against what its industry profile says it should be generating.
 * `lines` are the flattened waste lines (stage, stream_id, waste_class, tonnes, splits[]).
 * Findings: severity error (blocks issuing a report), warning, info.
 */
export function validateDeclaredWaste(industryId, lines) {
  const findings = [];
  const profile = getIndustry(industryId);
  const profileStreams = new Map();
  for (const s of profile.stages) for (const w of s.wastes) profileStreams.set(`${s.id}/${w.id}`, { stage: s, w });

  const declared = new Set(lines.filter((l) => typeof l.tonnes === 'number').map((l) => `${l.stage}/${l.stream_id}`));

  // 1. Expected hazardous streams that were not reported at all.
  for (const [key, { stage, w }] of profileStreams) {
    const cls = WASTE_CLASSES[w.waste_class];
    const entry = lines.find((l) => `${l.stage}/${l.stream_id}` === key);
    if (cls.hazardous && !declared.has(key) && (!entry || entry.basis === 'measurement_required')) {
      findings.push({ severity: 'warning', code: 'EXPECTED_HAZARDOUS_MISSING', stage: stage.id, stream: w.id, message: `${stage.name}: "${w.label}" is a hazardous stream normally generated here but no quantity was entered. Declare it (even if zero, with a reason) before issuing a report.` });
    }
  }

  for (const l of lines) {
    const key = `${l.stage}/${l.stream_id}`;
    const cls = WASTE_CLASSES[l.waste_class];
    const inProfile = profileStreams.get(key);

    // 2. Streams outside the industry profile.
    if (l.extra && !inProfile && l.stage !== 'general') {
      findings.push({ severity: 'info', code: 'STREAM_NOT_IN_PROFILE', stage: l.stage, stream: l.stream_id, message: `"${l.label}" is not a typical stream for ${profile.label}; confirm classification.` });
    }

    // 3. Benchmark range plausibility for measured quantities.
    if (inProfile?.w.per_t && l.basis === 'measured' && l.implied_per_t != null) {
      const { min, max } = inProfile.w.per_t;
      if (l.implied_per_t < min * 0.5 || l.implied_per_t > max * 2) {
        findings.push({ severity: 'warning', code: 'OUTSIDE_BENCHMARK', stage: l.stage, stream: l.stream_id, message: `"${l.label}": ${l.implied_per_t.toFixed(3)} t per t stage product is far outside the indicative range ${min}-${max}. Check weighbridge / units.` });
      }
    }

    // 4. Route permissibility.
    for (const sp of l.splits ?? []) {
      const route = ROUTES[sp.route];
      if (route.prohibited) findings.push({ severity: 'error', code: 'PROHIBITED_ROUTE', stage: l.stage, stream: l.stream_id, message: `"${l.label}" routed to ${route.label}.` });
      if (cls.hazardous && !route.hazardous_ok) {
        findings.push({ severity: 'error', code: 'HAZ_ROUTE_NOT_PERMITTED', stage: l.stage, stream: l.stream_id, message: `"${l.label}" is hazardous but routed to "${route.label}". Hazardous waste may only go to authorised recyclers, TSDFs, incinerators or co-processing facilities under HWM Rules 2016.` });
      }
      if (cls.hazardous && route.hazardous_ok && !sp.facility && sp.location !== 'onsite') {
        findings.push({ severity: 'warning', code: 'FACILITY_AUTH_MISSING', stage: l.stage, stream: l.stream_id, message: `"${l.label}": record the authorised facility name / SPCB authorisation number for the ${route.label} route (manifest evidence).` });
      }
      if (!cls.hazardous && l.waste_class === 'plastic' && sp.route.startsWith('landfill')) {
        findings.push({ severity: 'warning', code: 'PLASTIC_TO_LANDFILL', stage: l.stage, stream: l.stream_id, message: 'Plastic waste to landfill: EPR obligations under PWM Rules may apply; document handover to a registered recycler where possible.' });
      }
      if (sp.route_assumed) findings.push({ severity: 'info', code: 'ROUTE_ASSUMED', stage: l.stage, stream: l.stream_id, message: `"${l.label}": treatment route not stated, assumed "${route.label}". Confirm.` });
    }
  }
  return findings;
}
