// Lists every emission factor with its provenance and status.
//   npm run factors:check            -> table, exit 0
//   npm run factors:check -- --strict -> exit 1 if any factor is not validated (use before an assured report)
import { loadRegister } from '../src/engine/factors.js';

const reg = loadRegister();
console.log(`Factor register ${reg.version}  sha256 ${reg.hash.slice(0, 16)}...\n`);
for (const f of reg.factors) {
  console.log(`${f.status.padEnd(11)} ${f.id.padEnd(26)} ${String(f.valid_from).padEnd(11)}..${String(f.valid_to ?? 'open').padEnd(11)} ${f.source.document} [${f.source.table}]`);
}
const pending = reg.factors.filter((f) => f.status !== 'validated');
console.log(`\n${reg.factors.length - pending.length} validated, ${pending.length} provisional/retired.`);
console.log('Waste parameters (IPCC 2006 Vol.5 defaults in src/waste/taxonomy.js) are provisional as a set: IPCC2006-VOL5-DEFAULTS.');
if (process.argv.includes('--strict') && pending.length) {
  console.error('STRICT: unvalidated factors present - reports cannot be marked reviewed or assured.');
  process.exit(1);
}
