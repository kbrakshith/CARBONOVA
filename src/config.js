import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (no dependency). Real environment variables always win over the file.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = path.join(root, '.env')) {
  if (!existsSync(file)) return false;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

loadEnv();

export const config = {
  get port() { return Number(process.env.PORT ?? 3000); },
  get host() { return process.env.HOST ?? '127.0.0.1'; },
  get groqKey() { return (process.env.GROQ_API_KEY ?? '').trim(); },
  get groqModel() { return (process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile').trim(); },
  get groqBase() { return (process.env.GROQ_API_BASE ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''); },
  get aiTimeoutMs() { return Number(process.env.AI_TIMEOUT_MS ?? 25000); },
};
