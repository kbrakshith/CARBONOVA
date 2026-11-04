# Audit findings → implementation

Source: *CARBONOVA Technical & Carbon Accounting Audit Report* (18 Oct 2026), the CARBONOVA proposal and the October 2026 research brief.
"Done" means implemented and covered by a test. "Partial" and "Not done" are stated plainly.

| Audit item | Status | Where |
|---|---|---|
| 3.1 Factor register with source, table, version, geography, unit, gases, period, status, reviewer; provisional can't be "assured" | **Done** (register + gating). **Open:** no factor is validated yet; values still need checking against the originals | `src/data/factors.json`, `src/engine/factors.js`, `report.js` |
| 3.2 Scope 3 category model, partial inventories labelled, unassessed ≠ 0 | **Done** for screening; calculates cat. 3 (T&D, if given), 4/6/7/9 (fuel-based), 5 (waste) | `calculate.js` |
| 3.3 "BRSR-aligned" wording, statuses kept distinct | **Done** wording and 4 statuses. Buyer-specific export profiles: **not done** | `report.js` |
| 3.4 CEA version policy | **Partial**: version-pinned, validity-window warning, local override. CEA lists Version 22.0; its value was not verified here, so v20 is shipped as provisional | `factors.js`, `scope2.js` |
| 3.5 Evidence-to-report lineage, immutable reports | **Done** for hash-chained audit, input snapshot, manifest, immutable versions. Reviewer identity is a free-text name (no accounts yet) | `store.js`, `server.js` |
| 4.1 CO₂-only example | **Done**: gas-specific fuel factors, test documents the difference | `scope1.js` |
| 4.2 GWP and gas basis | **Done** `gas_basis` field, GWP set recorded, AR4/5/6 | `gwp.js` |
| 4.3 Electricity pathways | **Done**: imports vs solar vs export, contractual RE, location/market | `scope2.js` |
| 4.4 Waste: genuine FOD or honest factor method; gross vs avoided | **Done**: time-dependent FOD verified against closed form; route-specific; avoided not netted | `src/waste/fod.js`, `treatment.js` |
| 4.5 Boundaries, consolidation, exclusions | **Done** fields + validation + exclusions list. Base-year recalculation workflow: **not done** | `validate.js` |
| 5 Indian context | **Done**: FY April–March, INR intensity, BRSR P6 waste table, CEA/IPCC, SWM 2026 / HWM 2016 references. PPP-adjusted intensity: not done | `brsr.js` |
| 6.1 OCR with review | **Partial**: no OCR. A pasted-text assistant proposes kWh and dates with confidence; the user confirms each. Evidence is previewed beside the form and hashed | `public/js/billparse.js`, `energy.js` |
| 6.2 Factor/formula versioning | **Done** | `calculate.js` manifest |
| 6.3 DB schema with constraints | **Designed**, not wired: `db/schema.sql` (PostgreSQL). Prototype uses JSON files | `db/schema.sql` |
| 6.4 Multi-tenant isolation | **Partial**: per-organisation bearer token, tested isolation. **Not done:** email OTP, roles, buyer access, rate limits beyond org creation | `server.js` |
| 6.5 LLM categorisation | **Not done** (no LLM in this release; the rule is that AI never touches numbers) | n/a |
| 6.6 Report validation | **Done**: arithmetic reconciliation, gas-sum = total CO₂e, status gating, escaping. PDF is browser print-to-PDF | tests |
| 6.7 Duplicates, overlaps, data quality, uncertainty | **Done** duplicates/overlaps/quality; benchmark ranges for waste. Uncertainty propagation for spend-based: **not done** | `validate.js` |
| 7 Accuracy claims | No accuracy claim is made; no OCR exists to measure | n/a |
| 8.1 Narrow first release | Scope 1 + 2 + waste first; Scope 3 category by category | |
| 8.4 Reduction model | **Partial**: ranked actions with tCO2e avoided (engine re-run), range, upfront, saving, payback, assumptions echoed, flagged forward-looking. Costs are placeholders to replace with quotes | `reduction.js`, `scenario.js` |
| 10 Pilot acceptance tests | Calculation, provenance, duplicate, reconciliation, scope, audit: tested. Real-buyer acceptance and Indian-invoice OCR accuracy need a real pilot | |

## Research brief → product

Plain-language flow with save-and-return (server-side drafts), evidence kept with each line, deterministic maths, human confirmation, warnings instead of silent
fixes, accessible UI (labels, 44 px targets, focus rings, dark mode, text summaries), data minimisation (only a file hash leaves the browser),
Scope 1 / 2 first with a phased Scope 3. Usability testing with 5–8 users is still to be run.
