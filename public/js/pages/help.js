import { h, put, icon } from '../dom.js';
import { btn } from '../ui.js';

const FAQ = [
  ['What is a carbon footprint here?', 'The greenhouse gases released by your business activity, expressed as tonnes of carbon dioxide equivalent (tCO₂e). We add up fuel you burn, electricity you buy, and waste you generate, then convert every gas to CO₂e.'],
  ['What are Scope 1, 2 and 3?', 'Scope 1 is direct: fuel burned in your own generators, vehicles and furnaces, plus refrigerant leaks and process emissions. Scope 2 is electricity you buy from the grid. Scope 3 is everything else in your value chain, such as hired transport and waste sent to third parties.'],
  ['Why is Scope 3 not complete?', 'Scope 3 has fifteen categories and each needs its own data. We only calculate categories we can do defensibly and mark the rest "not assessed". Not assessed does not mean zero.'],
  ['How are the numbers calculated?', 'Activity data × emission factor, converted to CO₂e with published warming potentials. The calculation is fixed, versioned and repeatable. No AI is used to produce, change or approve any figure.'],
  ['Why does it say "provisional"?', 'A provisional factor has not yet been checked against its original published table by a named reviewer. Reports that use them can be a draft or self-declared, but cannot be marked reviewed or assured.'],
  ['What does the document reader do?', 'It reads the text layer of PDFs and parses CSV files, then suggests values with a confidence. It is not OCR and not AI. Scanned pages and photos need values typed in. Nothing is used until you check and approve it.'],
  ['Is this report accepted by my buyer?', 'We cannot promise that. The report is titled "BRSR-aligned supplier emissions data": supporting evidence you can hand to a buyer. It is not a BRSR filing, ISO 14064 verification or an assurance statement. Ask your buyer for their template and check it against the report.'],
  ['What is the difference between self-declared, reviewed and assured?', 'Self-declared: you state it is accurate. Internally reviewed: a second person in your business checked it. Externally assured: an independent assurance provider verified it. Only the first two can be set here.'],
  ['Why was my record rejected?', 'Records are checked when saved. Common reasons: a unit that does not fit the fuel, a negative quantity, an electricity bill whose dates overlap another bill on the same meter, a document uploaded twice, or hazardous waste sent to a route that cannot take it.'],
  ['Can I delete a record?', 'Yes, with a reason. It leaves your totals but stays in the audit trail, so a reviewer can see what happened.'],
];
const GLOSS = [['tCO₂e', 'Tonnes of carbon dioxide equivalent: all gases expressed as the amount of CO₂ with the same warming effect.'], ['Emission factor', 'How much of a gas is released per unit of activity, e.g. kg CO₂ per kWh.'], ['Organisational boundary', 'Which sites and activities count as yours for this report.'], ['Location-based', 'Electricity emissions using the average grid factor where you consume.'], ['Billing period', 'The dates a bill covers. Two bills on one meter must not overlap.']];

export function render(root, go) {
  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Help and support'), h('p', { class: 'sub' }, 'Plain-language answers. No carbon-accounting background needed.'))),
    h('div', { class: 'grid2' },
      h('section', { class: 'card' }, h('h3', {}, 'Get started in four steps'), h('ol', { style: 'padding-left:18px;line-height:1.8' },
        h('li', {}, 'Check your business details in ', h('a', { href: '#profile' }, 'Business profile'), '.'), h('li', {}, 'Upload a bill in ', h('a', { href: '#documents' }, 'Documents'), ' or add a record in ', h('a', { href: '#records' }, 'Activity records'), '.'), h('li', {}, 'Check the values and approve them.'), h('li', {}, 'See your result in ', h('a', { href: '#footprint' }, 'My carbon footprint'), ', then generate a ', h('a', { href: '#reports' }, 'report'), '.')),
        h('div', { class: 'row' }, btn('Restart guided setup', { onclick: () => go('onboarding') }))),
      h('section', { class: 'card' }, h('h3', {}, 'Words you will see'), h('dl', { class: 'kv', style: 'grid-template-columns:140px 1fr' }, GLOSS.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])))),
    h('section', { class: 'card' }, h('h3', {}, 'Frequently asked questions'), FAQ.map(([q, a]) => h('details', { style: 'border-bottom:1px solid var(--line);padding:8px 0' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, q), h('p', { class: 'muted', style: 'margin-top:6px' }, a)))),
    h('section', { class: 'card' }, h('h3', {}, 'Limits of this prototype'), h('ul', { class: 'muted' }, h('li', {}, 'No image or scanned-PDF OCR, and no AI features.'), h('li', {}, 'One access key per workspace: no per-person login, email OTP or enforced roles.'), h('li', {}, 'Reports are HTML you can print to PDF; no email delivery.'), h('li', {}, 'All emission factors are provisional until a reviewer validates them.'), h('li', {}, 'This is not legal, audit or certification advice.'))));
  void icon;
}
