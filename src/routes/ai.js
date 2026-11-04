import { httpError } from '../store.js';
import { aiStatus, aiConfigured, chatJson } from '../ai/groq.js';
import { suggestFields, classifyActivity, draftNarrative } from '../ai/tasks.js';
import { runInventory } from '../engine/calculate.js';
import { inventoryForFy, prevFy } from '../engine/periods.js';

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function registerAi({ on, withDoc, store, rateLimit }) {
  on('GET', '/api/ai/status', () => aiStatus(), { auth: false });

  // Every AI endpoint needs the key on the server AND the workspace owner's opt-in.
  const gate = (doc, req) => {
    if (!aiConfigured()) throw httpError(503, 'AI is not configured on this server. Add GROQ_API_KEY to the .env file and restart.');
    if (!doc.prefs?.ai_enabled) throw httpError(403, 'AI assistance is switched off for this workspace. Turn it on in Settings > AI assistance.');
    rateLimit(req, 20);
  };

  on('POST', '/api/orgs/:id/ai/test', withDoc(async ({ doc, req }) => {
    gate(doc, req);
    const r = await chatJson({ system: 'Reply with JSON only: {"ok":true}', user: 'ping', maxTokens: 20 });
    return { ok: r?.ok === true, model: aiStatus().model };
  }));

  on('POST', '/api/orgs/:id/ai/extract/:did', withDoc(async ({ doc, params, req }) => {
    gate(doc, req);
    const d = doc.documents?.find((x) => x.id === params.did);
    if (!d) throw httpError(404, 'Unknown document');
    if (d.status !== 'needs_review') throw httpError(409, 'Only documents waiting for review can be re-read.');
    const text = d.extraction.text;
    if (!text) throw httpError(422, 'There is no readable text in this document (scanned PDF or photo). AI here only reads text, so the values must be typed in.');
    const found = await suggestFields(d.doc_type, text);
    let added = 0;
    for (const f of found) {
      const cur = d.extraction.fields.find((x) => x.key === f.key);
      if (cur && cur.value !== '') continue; // never overwrite what the rule-based reader found
      const row = { key: f.key, label: cur?.label ?? f.key, value: f.value, unit: cur?.unit ?? null, confidence: f.confidence, source_ref: `AI suggestion, quoting: "${f.quote}"`, source: 'ai' };
      if (cur) Object.assign(cur, row); else d.extraction.fields.push(row);
      added++;
    }
    store.audit(doc, 'document.ai_suggested', 'ai', { id: d.id, added });
    store.save(doc);
    return { added, document: { ...d, file_path: undefined } };
  }));

  on('POST', '/api/orgs/:id/ai/classify', withDoc(async ({ doc, body, req }) => {
    gate(doc, req);
    if (!String(body.description ?? '').trim()) throw httpError(400, 'Describe the activity first.');
    return classifyActivity(body.description);
  }));

  /** The AI only receives numbers that are already saved results, and its output is rejected if it contains any other number. */
  on('POST', '/api/orgs/:id/ai/narrative', withDoc(async ({ doc, body, req }) => {
    gate(doc, req);
    const fy = body.fy ?? doc.inventory.organisation.reporting_fy;
    const cur = runInventory(inventoryForFy(doc.inventory, fy));
    const t = cur.result.totals_t;
    const top = {};
    for (const l of cur.result.lines) top[l.type] = (top[l.type] ?? 0) + l.co2eKg / 1000;
    const topEntry = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
    const facts = {
      fy, scope1_tco2e: round(t.scope1_t), scope2_location_tco2e: round(t.scope2_location_t), scope3_assessed_tco2e: round(t.scope3_assessed_t), total_tco2e: round(t.scope1_2_3_assessed_t),
      scope3_categories_assessed: cur.result.scope3_screening.filter((s) => s.status === 'calculated').length, largest_source: topEntry?.[0] ?? 'none', largest_source_tco2e: round(topEntry?.[1] ?? 0),
      measured_share_percent: round((cur.result.quality.measured_share ?? 0) * 100, 0),
    };
    if (doc.inventory.activities.some((a) => !a.voided && a.period?.start && inventoryForFy(doc.inventory, prevFy(fy)).activities.includes(a))) {
      const prev = runInventory(inventoryForFy(doc.inventory, prevFy(fy)));
      facts.previous_year_total_tco2e = round(prev.result.totals_t.scope1_2_3_assessed_t);
    }
    const text = await draftNarrative(facts);
    store.audit(doc, 'report.ai_narrative_drafted', 'ai', { fy });
    store.save(doc);
    return { text, facts, ai_drafted: true };
  }));
}
