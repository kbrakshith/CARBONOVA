# Waste methodology: stage-wise, by industry

## Why stage-wise

A process industry does not make "waste" in one place. Aluminium, for example, goes bauxite → alumina → aluminium → semi-finished
product, and every stage has its own input, product and residue (overburden and rejects, red mud, spent pot lining, dross).
A single "tonnes of waste" figure hides where it arises, cannot be sanity-checked against production, and cannot be classified
correctly (red mud is bulk and low-hazard per tonne; spent pot lining is small but hazardous).

CARBONOVA therefore models each industry as a **chain of stages** (`src/waste/industries.js`):

```
stage i:  chain input (previous stage's product)  +  other inputs  +  atmospheric inputs
        = product  +  co-products  +  waste streams  +  gases / moisture (balancing item)
```

Each waste stream is tied to a **waste class** (`src/waste/taxonomy.js`), which fixes whether it is hazardous, its BRSR
category, how it behaves in GHG calculations, and which treatment routes are lawful for it.

## How waste is identified for an industry

1. The unit picks its industry. The engine returns the stages and the waste streams *expected* at each stage
   (`GET /api/industries/:id`, `expectedStreams()`), each with class, hazard status, BRSR category, regulation reference and
   a typical route.
2. The unit enters what it weighed. Free-text help (`POST /api/waste/identify`) maps "pot lining" or "ETP sludge" to the right stream.
3. Validation (`validateDeclaredWaste`, `computeStageChain`) checks the declaration against the profile:

| Check | Severity | Example |
|---|---|---|
| Expected hazardous stream not declared | warning | Textile unit with no ETP sludge entry |
| Hazardous waste to a route that cannot take it | **error** | Spent pot lining to municipal landfill |
| Prohibited route | **error** | Open burning |
| Stream not in the industry profile | info | Plastic in a smelter stage |
| Quantity far outside the indicative range | warning | 400 t SPL for 1,030 t aluminium |
| Hazardous route without facility / authorisation reference | warning | SPL to "TSDF" with no SPCB no. |
| Outputs exceed inputs in a stage | **error** | Product + waste > feed |
| Unexplained mass far above the typical gas/moisture loss | warning | Red mud reported at 1/6 of expectation |
| Measured product does not match what the next stage consumes (>5%) | warning | Refining reports 3,000 t alumina; smelting used 1,978 t |
| Unknown stage or stream id (typo) | **error** | `red_mudd` (data would otherwise be silently dropped) |

Errors block a report from leaving draft status.

## Seeing it: the mass-flow diagram

The Waste page draws each stage as a column: the product that moves on (green ribbon into the next stage), each waste stream (amber, hazardous red), and the balancing item
(gases, moisture, unmeasured, hatched). Heights are proportional to tonnes. Dashed outlines are benchmark estimates; a small dashed box means "measurement required".
Every edit calls the stateless `POST /api/orgs/:id/preview`, which recomputes without storing anything, so the diagram and checks update as you type.

## Measured data wins; benchmarks fill gaps and are labelled

For each stream the engine uses, in order: **measured** tonnage → **benchmark estimate** (product × typical ratio, with min–max range)
→ **measurement required** (no benchmark exists). A stream needing measurement is shown as not assessed and is excluded from totals
with a note. It is never counted as zero.

When only the final product is known (e.g. 1,000 t semi-finished aluminium) the chain is walked backwards through each stage's yield:

| Stage | Product | Input needed | Key waste (typical) |
|---|---|---|---|
| Casting | 1,000 t | 1,030 t primary Al | dross 20 t (hazardous), scrap 10 t re-melted |
| Smelting | 1,030 t Al | 1,978 t alumina + 433 t anode | spent pot lining 26 t (hazardous) + process CO₂/PFC |
| Refining | 1,978 t alumina | 4,944 t bauxite | red mud ≈ 2,373 t dry |
| Mining | 4,944 t bauxite | 5,834 t run-of-mine | rejects ≈ 890 t, overburden (measure) |

The benchmark ratios are **indicative** literature-style values, chosen so that each stage's mass balance closes. They are a first estimate for
a unit with no waste register, not a substitute for weighbridge data and manifests. Replace them as soon as real records exist.

## Industries covered

Aluminium · Steel (integrated BF-BOF) · Cement · Textile and garment · Food and agro-processing · Foundry · Chemicals and pharma (batch) ·
Other MSME (single stage). Chemicals/pharma and generic MSME have no mass benchmarks on purpose: batch chemistry and site mix vary too much,
so every stream is "measurement required" instead of a made-up ratio. Add an industry by adding a profile object; the tests check that
every profile uses real waste classes and routes, has ordered ranges, permits its hazardous default routes, and closes its mass balance.

## Process emissions

Where a stage has direct process emissions (smelter anode CO₂ and PFCs, calcination, reductant carbon in ironmaking) the stage is marked
`process_emissions.expected`. If none are entered the engine lists it under exclusions. Cement calcination has a default
(0.52 t CO₂/t clinker, flagged "estimated default"). For smelting, the engine's mass-balance residual is a cross-check: the sample's 1,580 t
process CO₂ against a ≈1,560 t balancing item.

## GHG from waste: route-specific, gross, never blended

| Route | Method |
|---|---|
| Landfill (managed / unmanaged deep / shallow / secure cell) | IPCC 2006 Vol.5 **first-order decay**, time-dependent: DOC, DOCf 0.5, MCF by landfill type, k by climate (rainfall ≥ 1000 mm = tropical wet) and decay speed, 6-month delay, F 0.5, optional methane recovery and oxidation. Reports lifetime CH₄ of waste generated in the reporting year (GHG Protocol Scope 3 cat. 5 convention) and the in-year part |
| Composting / anaerobic digestion | IPCC Vol.5 Table 4.1: 4 / 0.8 kg CH₄ per t wet (+ N₂O for composting) |
| Incineration / co-processing / open burning | Fossil CO₂ = W × dm × CF × FCF × OF × 44/12, plus CH₄ and N₂O. Hazardous organics need a lab carbon fraction, otherwise *not assessed* |
| Recycling, re-use, other recovery, on-site engineered storage | No gross treatment emissions modelled. **Avoided emissions are not netted** |
| Inorganic and hazardous inorganic (red mud, slag, SPL, dross) | No biodegradable carbon, so no FOD methane. Mass is still reported |

**Scope:** treatment inside the organisational boundary (`location: onsite`) is Scope 1; third-party treatment is Scope 3 category 5.
Landfill emissions are tested against the closed-form total of the same model, so carbon is conserved.

## BRSR Principle 6 mapping

Every line lands in one of the eight BRSR waste categories (plastic, e-waste, bio-medical, C&D, battery, radioactive, other hazardous, other non-hazardous),
and its route lands in recovered (recycled / re-used / other recovery) or disposed (incineration / landfill / other disposal). The table also states how many tonnes
are benchmark-estimated and how many streams lack a quantity. Confirm the layout against the current SEBI BRSR format before filing.

## Regulatory references and their confidence

| Instrument | Used for | Status in code |
|---|---|---|
| Hazardous and Other Wastes (Management & Transboundary Movement) Rules, 2016 | hazard status, permitted routes, authorisation | `verified: false` |
| Same, Schedule I items 11.2 (pot lining) and 11.5 (dross / salt slag) | aluminium streams | from a secondary summary; `ref_confidence: secondary`: **confirm against the Gazette text** |
| CPCB red-mud guidance (Aug 2024), HVLE treatment | red mud | `verified: false` |
| Solid Waste Management Rules, 2026 (notified 27 Jan 2026, in force 1 Apr 2026) | canteen/general waste | verified from news and government summaries |
| Plastic (EPR), E-waste 2022, Battery 2022, Bio-medical 2016, C&D 2016 | category and route notes | `verified: false` |

Nothing here is legal advice. Authorisations and manifests remain the unit's responsibility.
