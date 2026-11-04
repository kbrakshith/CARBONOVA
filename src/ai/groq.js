import { config } from '../config.js';
import { httpError } from '../store.js';

/**
 * Thin Groq client (OpenAI-compatible chat completions). Server-side only: the key never reaches the browser.
 * AI in CARBONOVA may suggest or draft text. It never produces, changes or approves an emission figure.
 */
export const aiConfigured = () => config.groqKey.length > 10;
export const aiStatus = () => ({ configured: aiConfigured(), provider: 'Groq', model: config.groqModel });

/** Remove obvious personal identifiers before text leaves the server. */
export function redact(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '[phone]')
    .replace(/\b\d{12,}\b/g, '[long-number]');
}

export async function chatJson({ system, user, maxTokens = 700 }) {
  if (!aiConfigured()) throw httpError(503, 'AI is not configured on this server. Add GROQ_API_KEY to the .env file and restart.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.aiTimeoutMs);
  let res;
  try {
    res = await fetch(`${config.groqBase}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groqKey}` },
      body: JSON.stringify({ model: config.groqModel, temperature: 0, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
  } catch (e) {
    throw httpError(504, e.name === 'AbortError' ? 'The AI service took too long to answer. Try again.' : 'Could not reach the AI service. Check your internet connection.');
  } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) throw httpError(502, 'The AI service rejected the API key. Check GROQ_API_KEY in .env.');
  if (res.status === 429) throw httpError(429, 'The AI service is rate limiting requests. Wait a moment and retry.');
  if (!res.ok) throw httpError(502, `The AI service returned an error (${res.status}).`);
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw httpError(502, 'The AI service returned an empty answer.');
  try { return JSON.parse(content); } catch { throw httpError(502, 'The AI service returned an answer that was not valid JSON.'); }
}
