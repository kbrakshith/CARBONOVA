// Industry process profiles for stage-wise waste identification.
//
// Why stage-wise: waste in process industries is created at specific stages (bauxite -> alumina -> aluminium
// -> semi-finished product), each with its own input, product and residues. Waste for the unit is the sum over stages
// and is only meaningful per tonne of FINAL product when carried back through each stage's yield.
//
// Benchmark ranges (per tonne of that stage's product) are INDICATIVE literature-style values to give a first
// estimate when a unit has no waste register. They are labelled `estimated_benchmark` in every result and must be
// replaced by weighbridge/manifest data. Where a stream depends on site chemistry or product mix, per_t is null
// and the stream is "measurement required" - the engine will not invent a number.
//
// Regulation notes: HWM Rules item numbers are only given where a secondary source stated them; all are
// flagged `ref_confidence: 'secondary'` and must be confirmed against the Gazette text.

const R = (min, typ, max) => ({ min, typ, max });

const HAZ_INORG = 'hazardous_inorganic';

export const INDUSTRIES = {
  aluminium: {
    label: 'Aluminium (bauxite to semi-finished product)',
    nic_hint: 'NIC 2420 (basic precious and other non-ferrous metals)',
    final_product: 'Aluminium semi-finished product (t)',
    stages: [
      {
        id: 'mining', name: 'Bauxite mining and beneficiation', product: 'Beneficiated bauxite',
        chain_input: { label: 'Run-of-mine bauxite', per_t: R(1.05, 1.18, 1.43) },
        wastes: [
          { id: 'overburden', label: 'Overburden / topsoil', waste_class: 'inorganic_mineral', per_t: null, default_route: 'other_recovery', note: 'Site-specific stripping ratio: measure (back-filling / mine reclamation counts as recovery).' },
          { id: 'beneficiation_rejects', label: 'Washing / beneficiation rejects', waste_class: 'inorganic_mineral', per_t: R(0.05, 0.18, 0.43), default_route: 'engineered_onsite_storage' },
        ],
      },
      {
        id: 'refining', name: 'Alumina refining (Bayer process)', product: 'Alumina (Al2O3)',
        chain_input: { label: 'Beneficiated bauxite', per_t: R(2.0, 2.5, 3.5) },
        other_inputs: [],
        wastes: [
          { id: 'red_mud', label: 'Red mud (bauxite residue), dry basis', waste_class: 'inorganic_mineral', brsr: 'other_hazardous', per_t: R(1.0, 1.2, 1.5), default_route: 'engineered_onsite_storage', hvle: true, regs: ['HWM_2016', 'CPCB_RED_MUD_2024'], ref_confidence: 'secondary', note: 'Handled as high-volume low-effect waste under CPCB guidance; utilisation (cement, bricks, road, iron recovery) counts as recovery.' },
          { id: 'dregs_scale', label: 'Lime grits, dregs and scale', waste_class: 'inorganic_mineral', per_t: null, default_route: 'engineered_onsite_storage' },
        ],
      },
      {
        id: 'smelting', name: 'Smelting (Hall-Heroult electrolysis)', product: 'Primary aluminium (molten)',
        chain_input: { label: 'Alumina', per_t: R(1.89, 1.92, 1.95) },
        other_inputs: [{ id: 'anode', label: 'Baked carbon anode (net)', per_t: R(0.40, 0.42, 0.45) }],
        atmospheric_inputs: [{ id: 'air_o2', label: 'Atmospheric oxygen (anode air-burn)', per_t: R(0.1, 0.2, 0.3) }],
        wastes: [
          { id: 'spent_pot_lining', label: 'Spent pot lining (SPL)', waste_class: HAZ_INORG, per_t: R(0.015, 0.025, 0.035), default_route: 'secure_landfill', regs: ['HWM_2016'], reg_item: 'Sch. I, 11.2 (cathode residues incl. pot lining)', ref_confidence: 'secondary', note: 'Hazardous; CPCB procedure for SPL handling applies. Co-processing / authorised treatment preferred to landfill.' },
        ],
        process_emissions: { expected: true, gases: ['CO2', 'CF4', 'C2F6'], note: 'Anode carbon CO2 and PFCs (anode effects) are Scope 1 process emissions: enter measured/derived values.' },
      },
      {
        id: 'casting', name: 'Casting, rolling and extrusion', product: 'Semi-finished aluminium',
        chain_input: { label: 'Molten / primary aluminium', per_t: R(1.01, 1.03, 1.10) },
        wastes: [
          { id: 'dross', label: 'Aluminium dross / skimmings (black dross, salt slag)', waste_class: HAZ_INORG, per_t: R(0.01, 0.02, 0.04), default_route: 'recycling', regs: ['HWM_2016'], reg_item: 'Sch. I, 11.5 (salt slag / black dross)', ref_confidence: 'secondary', note: 'Send only to an authorised dross recycler / reprocessor.' },
          { id: 'process_scrap', label: 'In-house metal scrap (re-melted)', waste_class: 'metal_scrap', per_t: R(0, 0.01, 0.03), default_route: 'reuse' },
        ],
      },
    ],
  },

  steel_integrated: {
    label: 'Steel - integrated BF-BOF route (ore to rolled product)',
    nic_hint: 'NIC 2410 (basic iron and steel)',
    final_product: 'Rolled steel product (t)',
    stages: [
      {
        id: 'ironmaking', name: 'Ironmaking (sinter / blast furnace)', product: 'Hot metal',
        chain_input: { label: 'Iron ore (lump + sinter + pellet)', per_t: R(1.5, 1.6, 1.75) },
        wastes: [
          { id: 'bf_slag', label: 'Blast furnace slag', waste_class: 'inorganic_mineral', per_t: R(0.28, 0.35, 0.45), default_route: 'other_recovery', note: 'Granulated slag normally sold to cement - recovery.' },
          { id: 'bf_dust_sludge', label: 'BF / sinter dust and sludge', waste_class: 'inorganic_mineral', per_t: R(0.01, 0.02, 0.04), default_route: 'other_recovery', note: 'Zinc / lead bearing sludge can be hazardous: confirm by analysis.' },
        ],
        process_emissions: { expected: true, gases: ['CO2'], note: 'Reductant carbon (coke / coal) is a Scope 1 process emission: derive by carbon mass balance.' },
      },
      {
        id: 'steelmaking', name: 'Steelmaking (BOF / LD converter)', product: 'Crude steel',
        chain_input: { label: 'Hot metal', per_t: R(0.75, 0.85, 0.92) },
        other_inputs: [{ id: 'scrap', label: 'Steel scrap', per_t: R(0.10, 0.20, 0.30) }, { id: 'flux', label: 'Fluxes (lime, dolomite)', per_t: R(0.05, 0.08, 0.12) }],
        atmospheric_inputs: [{ id: 'oxygen', label: 'Blown oxygen', per_t: R(0.05, 0.08, 0.10) }],
        wastes: [
          { id: 'bof_slag', label: 'BOF / LD slag', waste_class: 'inorganic_mineral', per_t: R(0.12, 0.15, 0.20), default_route: 'other_recovery' },
          { id: 'steel_plant_dust', label: 'Steel melt shop dust and sludge', waste_class: 'inorganic_mineral', per_t: R(0.01, 0.02, 0.03), default_route: 'other_recovery' },
        ],
      },
      {
        id: 'rolling', name: 'Casting and hot rolling', product: 'Rolled product',
        chain_input: { label: 'Crude steel', per_t: R(1.05, 1.08, 1.15) },
        wastes: [
          { id: 'mill_scale', label: 'Mill scale', waste_class: 'inorganic_mineral', per_t: R(0.01, 0.02, 0.03), default_route: 'recycling' },
          { id: 'crop_ends', label: 'Crop ends / cobbles (re-melted)', waste_class: 'metal_scrap', per_t: R(0.03, 0.06, 0.09), default_route: 'reuse' },
          { id: 'used_oil', label: 'Used lubricating / hydraulic oil', waste_class: 'used_oil', per_t: null, default_route: 'recycling', regs: ['HWM_2016'], note: 'Only to a CPCB-registered used-oil recycler.' },
        ],
      },
    ],
  },

  cement: {
    label: 'Cement (limestone to cement)',
    nic_hint: 'NIC 2394 (cement, lime and plaster)',
    final_product: 'Cement (t)',
    stages: [
      {
        id: 'quarry', name: 'Limestone quarrying and crushing', product: 'Crushed limestone',
        chain_input: { label: 'Run-of-mine limestone', per_t: R(1.02, 1.05, 1.15) },
        wastes: [{ id: 'overburden', label: 'Overburden / crusher rejects', waste_class: 'inorganic_mineral', per_t: null, default_route: 'other_recovery' }],
      },
      {
        id: 'kiln', name: 'Raw meal and clinkerisation', product: 'Clinker',
        chain_input: { label: 'Raw meal (limestone + additives)', per_t: R(1.5, 1.55, 1.6) },
        wastes: [{ id: 'ckd', label: 'Cement kiln dust (not returned to kiln)', waste_class: 'inorganic_mineral', per_t: R(0, 0.02, 0.06), default_route: 'other_recovery' }],
        process_emissions: { expected: true, gases: ['CO2'], note: 'Calcination CO2.' },
        process_default: { gas: 'CO2', kg_per_t_product: 520, basis: 'IPCC 2006 Vol.3 Table 2.1 default clinker EF 0.52 t CO2/t clinker (carbonate calcination, excludes fuel)', status: 'provisional' },
      },
      {
        id: 'grinding', name: 'Cement grinding and packing', product: 'Cement',
        chain_input: { label: 'Clinker', per_t: R(0.55, 0.70, 0.95) },
        other_inputs: [{ id: 'gypsum', label: 'Gypsum', per_t: R(0.03, 0.05, 0.06) }, { id: 'sap', label: 'Fly ash / slag (blended cement)', per_t: R(0, 0.25, 0.40) }],
        wastes: [
          { id: 'bag_filter_dust', label: 'Bag filter dust (not recycled)', waste_class: 'inorganic_mineral', per_t: null, default_route: 'other_recovery' },
          { id: 'packaging_waste', label: 'Torn bags / packaging', waste_class: 'plastic', per_t: null, default_route: 'recycling', regs: ['PWM'] },
        ],
      },
    ],
  },

  textile: {
    label: 'Textile and garment (fibre to garment)',
    nic_hint: 'NIC 13 / 14 (textiles, wearing apparel)',
    final_product: 'Finished garments (t)',
    stages: [
      {
        id: 'spinning', name: 'Spinning', product: 'Yarn',
        chain_input: { label: 'Raw cotton / fibre', per_t: R(1.10, 1.20, 1.30) },
        wastes: [{ id: 'fibre_waste', label: 'Comber noil, flat strips, sweepings (fibre waste)', waste_class: 'textile', per_t: R(0.10, 0.18, 0.28), default_route: 'recycling' }],
      },
      {
        id: 'fabric', name: 'Weaving / knitting', product: 'Grey fabric',
        chain_input: { label: 'Yarn', per_t: R(1.01, 1.03, 1.06) },
        wastes: [{ id: 'yarn_waste', label: 'Yarn / selvedge waste', waste_class: 'textile', per_t: R(0.01, 0.03, 0.06), default_route: 'recycling' }],
      },
      {
        id: 'wet_processing', name: 'Wet processing (desizing, bleaching, dyeing, finishing)', product: 'Finished fabric',
        chain_input: { label: 'Grey fabric', per_t: R(1.02, 1.05, 1.10) },
        wastes: [
          { id: 'etp_sludge', label: 'Effluent treatment plant (ETP) sludge', waste_class: HAZ_INORG, per_t: null, default_route: 'secure_landfill', regs: ['HWM_2016'], note: 'Treated conservatively as hazardous; re-classify to non-hazardous only with lab evidence and SPCB authorisation.' },
          { id: 'chemical_containers', label: 'Empty dye / chemical containers', waste_class: HAZ_INORG, per_t: null, default_route: 'recycling', regs: ['HWM_2016'], note: 'Decontaminated containers go back to authorised recyclers.' },
        ],
      },
      {
        id: 'garmenting', name: 'Cutting and stitching', product: 'Garments',
        chain_input: { label: 'Finished fabric', per_t: R(1.10, 1.15, 1.20) },
        wastes: [
          { id: 'cutting_waste', label: 'Cutting waste / clippings', waste_class: 'textile', per_t: R(0.10, 0.15, 0.20), default_route: 'recycling' },
          { id: 'packaging', label: 'Poly-bag / carton packaging waste', waste_class: 'plastic', per_t: null, default_route: 'recycling', regs: ['PWM'] },
        ],
      },
    ],
  },

  food_processing: {
    label: 'Food and agro-processing',
    nic_hint: 'NIC 10 (food products)',
    final_product: 'Packed food product (t)',
    stages: [
      {
        id: 'receiving', name: 'Receiving, cleaning and grading', product: 'Cleaned raw material',
        chain_input: { label: 'Raw produce / grain', per_t: R(1.02, 1.05, 1.15) },
        wastes: [
          { id: 'reject_produce', label: 'Rejects, trash and spoiled raw material', waste_class: 'food_organic', per_t: null, default_route: 'composting' },
          { id: 'soil_stones', label: 'Soil, stones, sand', waste_class: 'inorganic_mineral', per_t: null, default_route: 'other_disposal' },
        ],
      },
      {
        id: 'processing', name: 'Processing (peeling, milling, extraction, cooking)', product: 'Processed product',
        chain_input: { label: 'Cleaned raw material', per_t: null },
        wastes: [
          { id: 'peel_husk_pomace', label: 'Peel, husk, bran, pomace, spent grain', waste_class: 'food_organic', per_t: null, default_route: 'other_recovery', note: 'Product-specific: very often sold as animal feed (recovery).' },
          { id: 'etp_sludge', label: 'ETP sludge (organic)', waste_class: 'organic_sludge', per_t: null, default_route: 'composting' },
        ],
      },
      {
        id: 'packing', name: 'Packing', product: 'Packed product',
        chain_input: { label: 'Processed product', per_t: R(1.00, 1.02, 1.05) },
        wastes: [
          { id: 'packaging_waste', label: 'Rejected packaging', waste_class: 'plastic', per_t: null, default_route: 'recycling', regs: ['PWM'] },
          { id: 'paper_packaging', label: 'Cartons / paper', waste_class: 'paper_cardboard', per_t: null, default_route: 'recycling' },
        ],
      },
    ],
  },

  foundry: {
    label: 'Foundry and metal casting',
    nic_hint: 'NIC 2431 / 2432 (casting of iron, steel, non-ferrous)',
    final_product: 'Good castings (t)',
    stages: [
      {
        id: 'melting', name: 'Melting (cupola / induction)', product: 'Molten metal',
        chain_input: { label: 'Metal charge (pig iron, scrap, returns)', per_t: R(1.02, 1.05, 1.10) },
        wastes: [
          { id: 'slag', label: 'Melting slag', waste_class: 'inorganic_mineral', per_t: R(0.03, 0.05, 0.08), default_route: 'other_recovery' },
          { id: 'furnace_dust', label: 'Furnace / bag-filter dust', waste_class: 'inorganic_mineral', per_t: null, default_route: 'secure_landfill', note: 'Confirm hazardous / non-hazardous by analysis.' },
        ],
      },
      {
        id: 'casting', name: 'Moulding, pouring and fettling', product: 'Good castings',
        chain_input: { label: 'Molten metal', per_t: R(1.5, 1.7, 2.2) },
        other_inputs: [{ id: 'moulding_sand', label: 'Moulding / core sand (incl. binders)', per_t: R(0.5, 0.9, 1.3) }],
        wastes: [
          { id: 'used_sand', label: 'Spent foundry sand', waste_class: 'inorganic_mineral', per_t: R(0.5, 0.9, 1.3), default_route: 'other_recovery', note: 'Reclaimed / used in bricks, roads: recovery.' },
          { id: 'gating_returns', label: 'Gates, risers and rejects (re-melted)', waste_class: 'metal_scrap', per_t: R(0.5, 0.7, 1.2), default_route: 'reuse' },
          { id: 'used_oil', label: 'Used oil / coolant', waste_class: 'used_oil', per_t: null, default_route: 'recycling', regs: ['HWM_2016'] },
        ],
      },
    ],
  },

  chemicals_pharma: {
    label: 'Chemicals and pharmaceuticals (batch)',
    nic_hint: 'NIC 20 / 21',
    final_product: 'Finished product (t)',
    stages: [
      {
        id: 'synthesis', name: 'Reaction and synthesis', product: 'Crude product',
        chain_input: { label: 'Raw materials and intermediates', per_t: null },
        wastes: [
          { id: 'distillation_residue', label: 'Distillation / process residue', waste_class: 'hazardous_organic', per_t: null, default_route: 'co_processing', regs: ['HWM_2016'] },
          { id: 'spent_solvent', label: 'Spent solvents', waste_class: 'hazardous_organic', per_t: null, default_route: 'recycling', regs: ['HWM_2016'] },
          { id: 'spent_catalyst', label: 'Spent catalyst / carbon', waste_class: HAZ_INORG, per_t: null, default_route: 'recycling', regs: ['HWM_2016'] },
        ],
      },
      {
        id: 'purification', name: 'Purification, drying and packing', product: 'Finished product',
        chain_input: { label: 'Crude product', per_t: null },
        wastes: [
          { id: 'mother_liquor_salts', label: 'Evaporation salts (MEE / ATFD)', waste_class: HAZ_INORG, per_t: null, default_route: 'secure_landfill', regs: ['HWM_2016'] },
          { id: 'etp_sludge', label: 'ETP sludge', waste_class: HAZ_INORG, per_t: null, default_route: 'secure_landfill', regs: ['HWM_2016'] },
          { id: 'expired_products', label: 'Off-spec / expired product', waste_class: 'hazardous_organic', per_t: null, default_route: 'incineration', regs: ['HWM_2016'] },
        ],
      },
    ],
  },

  generic_msme: {
    label: 'Other MSME (assembly, trading, services, workshop)',
    nic_hint: 'any',
    final_product: 'n/a (no process chain)',
    stages: [
      {
        id: 'operations', name: 'Site operations (single stage)', product: 'Goods / services',
        chain_input: { label: 'Materials', per_t: null },
        wastes: [
          { id: 'paper', label: 'Paper and cardboard', waste_class: 'paper_cardboard', per_t: null, default_route: 'recycling' },
          { id: 'plastic_packaging', label: 'Plastic packaging', waste_class: 'plastic', per_t: null, default_route: 'recycling', regs: ['PWM'] },
          { id: 'canteen', label: 'Canteen / food waste', waste_class: 'food_organic', per_t: null, default_route: 'composting', regs: ['SWM_2026'] },
          { id: 'metal_scrap', label: 'Metal scrap / swarf', waste_class: 'metal_scrap', per_t: null, default_route: 'recycling' },
          { id: 'e_waste', label: 'E-waste (IT, electricals)', waste_class: 'e_waste', per_t: null, default_route: 'recycling', regs: ['EWASTE_2022'] },
          { id: 'batteries', label: 'Used batteries (UPS, lead-acid, Li-ion)', waste_class: 'battery', per_t: null, default_route: 'recycling', regs: ['BATTERY_2022'] },
          { id: 'used_oil', label: 'Used oil, oily rags', waste_class: 'used_oil', per_t: null, default_route: 'recycling', regs: ['HWM_2016'] },
          { id: 'general_sweepings', label: 'Mixed sweepings / general waste', waste_class: 'paper_cardboard', per_t: null, default_route: 'landfill_managed', regs: ['SWM_2026'], note: 'Assigned to the paper/cardboard DOC as the nearest class unless a composition audit is available.' },
        ],
      },
    ],
  },
};

export function getIndustry(id) {
  const p = INDUSTRIES[id];
  if (!p) throw new Error(`Unknown industry "${id}". Known: ${Object.keys(INDUSTRIES).join(', ')}`);
  return p;
}

export function listIndustries() {
  return Object.entries(INDUSTRIES).map(([id, p]) => ({ id, label: p.label, nic_hint: p.nic_hint, final_product: p.final_product, stage_count: p.stages.length }));
}
