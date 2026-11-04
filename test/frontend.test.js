import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBillText, parseDates } from '../public/js/billparse.js';

const jsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');

test('every front-end module parses and its imports resolve (main.js needs a DOM and is skipped)', async () => {
  const files = [...readdirSync(jsDir).filter((f) => f.endsWith('.js') && f !== 'main.js'), ...readdirSync(path.join(jsDir, 'pages')).map((f) => `pages/${f}`)];
  assert.ok(files.length >= 10);
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(jsDir, f)).href);
    assert.ok(Object.keys(mod).length > 0, `${f} exports something`);
  }
});

test('bill parser suggests values with confidence and never invents when nothing matches', () => {
  const bill = `ACME DISCOM  Consumer No 1234
Billing period: 01/04/2026 to 30/04/2026
Previous reading 10450  Current reading 14550
Units consumed   4,100
Arrears 0.00`;
  const r = parseBillText(bill);
  assert.equal(r.kwh[0].value, 4100);
  assert.equal(r.kwh[0].confidence, 0.8);
  assert.deepEqual([r.dates[0].start, r.dates[0].end], ['2026-04-01', '2026-04-30']);

  const loose = parseBillText('Total 5200 kWh this month');
  assert.equal(loose.kwh[0].value, 5200);
  assert.equal(loose.kwh[0].confidence, 0.5);

  const none = parseBillText('Thank you for your payment');
  assert.equal(none.kwh.length, 0);
  assert.equal(none.dates.length, 0);
  assert.ok(none.notes.some((n) => /No kWh/.test(n)));

  const single = parseBillText('Due 15-Jun-2026. Units consumed 300');
  assert.equal(single.dates.length, 0);
  assert.ok(single.notes.some((n) => /Only one date/.test(n)));
});

test('date parsing handles dd/mm/yyyy, dd-Mon-yyyy and rejects impossible dates', () => {
  assert.deepEqual(parseDates('from 05-Mar-2026 and 31/13/2026 and 01.02.2026').map((d) => d.iso), ['2026-03-05', '2026-02-01']);
});

test('bill parser prefers the explicit billing-period range over other dates on the bill', () => {
  const r = parseBillText('Bill date: 03/11/2026\nBilling period: 01/10/2026 to 31/10/2026\nDue date 20/11/2026\nUnits consumed 44,260');
  assert.deepEqual([r.dates[0].start, r.dates[0].end], ['2026-10-01', '2026-10-31']);
  assert.equal(r.dates[0].confidence, 0.85);
});
