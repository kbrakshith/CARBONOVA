# Carbon accounting methodology

All arithmetic is deterministic JavaScript in `src/engine/`. No LLM performs or influences any number. The same input and factor
register always produce the same `result_hash`.

## Boundary and period

* Indian financial year (1 April – 31 March). Activities outside the year are rejected; straddling activities warn.
* Organisation boundary recorded up front: legal entity, facilities, consolidation approach (operational control by default),
  exclusions. Third-party equipment is never silently Scope 1: it needs a Scope 3 category.

## Formula

```
E_gas      = activity × factor                 (per gas, kg)
CO2e       = Σ E_gas × GWP_gas                 (GWP set recorded in the manifest; AR6 default, AR5/AR4 selectable)
Fuel E_gas = mass(t) × NCV(GJ/t) / 1000 × EF(kg gas/TJ)       IPCC 2006 Vol.2, CO2 + CH4 + N2O
```

Factors state their `gas_basis` (CO2, individual_gas, CO2e) so a CO2e factor can never be multiplied by a GWP a second time.
The proposal's worked example (5,000 kWh + 400 L diesel + 600 L petrol = 6,022 kg) is CO₂-only; with CH₄ and N₂O included the fuel lines
come out slightly higher, and a test pins both facts.

## Electricity (Scope 2)

* Only **grid imports** carry the grid factor. Solar is recorded as generated / self-consumed / exported and reconciled
  (self + export ≤ generation); it is never added or subtracted blindly.
* Location-based is the headline. Market-based subtracts only documented contractual renewable kWh; India publishes no residual-mix
  factor, so the remainder uses the grid average and the report says so.
* Optional T&D loss % produces a separate Scope 3 category 3 line. If it is not given, category 3 is *not assessed*.
* The grid factor is CO₂-only (CEA); this is listed as an exclusion in every report.
* The factor's validity window is compared with the reporting year. A mismatch raises `FACTOR_PERIOD`.

## Scope 3

All 15 categories are screened on every run: **calculated**, **excluded with reason**, or **not assessed**. Not assessed is never zero, and the Scope 3 headline is labelled
"assessed categories only". This release calculates category 5 (waste), 4/6/7/9 via fuel purchased for third-party vehicles, and 3 (T&D loss) when provided.

## Biogenic CO₂, refrigerants, process emissions

Biogenic CO₂ (wood) is reported outside the scopes; its CH₄ and N₂O are counted. Refrigerant leakage uses GWPs of the component gases (blends decomposed). Process emissions are entered per gas
and converted with the GWP set.

## Evidence and quality

* Evidence is hashed (SHA-256 in the browser); the same document twice, or overlapping periods on the same meter/fuel stream, are rejected.
* Low-confidence extracted values that nobody confirmed warn. Estimates need a stated basis.
* The report shows the share of emissions from measured versus estimated data.

## Reproducibility

Each calculation stores an input snapshot and a manifest: engine version, formula versions, GWP values, every factor used with status and source,
the factor-register hash, and input/result hashes. `GET /api/orgs/:id/runs/:rid/verify` recomputes from the snapshot and compares hashes. Reports are generated
from the stored snapshot, never from edited live data, and are immutable: a correction issues a new version. The audit log is a hash chain.

## Report status rules

| Status | Who can set it | Blocked when |
|---|---|---|
| draft | anyone | never |
| self_declared | the responsible person named in `issued_by` | any blocking error |
| internally_reviewed | named reviewer | blocking error **or any provisional factor** |
| externally_assured | not available in this system | an independent assurer records it outside the engine |

The report calls itself "BRSR-aligned supplier emissions data". It does not claim BRSR compliance, ISO 14064 verification or buyer acceptance.

## Promoting a factor

1. Open the original table (e.g. the CEA user guide for the reporting year).
2. Copy `data/factors.local.example.json` to `data/factors.local.json`, fill the values from that table, and set `status: "validated"` with `reviewer` and `reviewed_on`.
3. `npm run factors:check` lists status; `npm run factors:check -- --strict` fails while any factor is provisional.
4. Old factor versions stay in the register so historical runs still reproduce.
