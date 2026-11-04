import { runInventory } from '../src/engine/calculate.js';
import { sampleAluminiumUnit } from '../src/sample.js';

const { result, manifest, report_eligibility } = runInventory(sampleAluminiumUnit());
console.log(JSON.stringify({ totals_t: result.totals_t, quality: result.quality, intensity: result.intensity }, null, 2));
const c = result.waste.chain;
console.log('Waste per t final product:', c.summary.waste_per_t_final_product, '| total t:', c.summary.total_waste_t_known, '| hazardous t:', c.summary.hazardous_t);
for (const s of c.stages) {
  console.log(`\n${s.name}  product=${s.product_t}t  input=${s.chain_input.tonnes}t (${s.chain_input.basis})  balance=${s.mass_balance.status} gap=${s.mass_balance.unexplained_fraction}`);
  for (const w of s.streams) console.log(`   - ${w.label}: ${w.tonnes ?? 'MEASURE'} t [${w.basis}] ${w.hazardous ? 'HAZ' : ''}`);
}
console.log('\nBRSR waste total:', result.waste.brsr.total);
console.log('\nBlocking:', report_eligibility.blocking);
console.log('Allowed statuses:', report_eligibility.allowed_statuses);
console.log('Findings:', result.waste.findings.map((f) => `${f.severity}:${f.code}`).join(', '));
console.log('Manifest hashes:', manifest.input_hash.slice(0, 12), manifest.result_hash.slice(0, 12));
