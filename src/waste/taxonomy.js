// Waste classes, regulatory references and treatment routes.
//
// All numeric parameters below are IPCC 2006 Guidelines Vol.5 defaults (Tables 2.4, 3.3, 4.1, 5.2-5.6)
// as recalled by the author and NOT yet checked against the printed tables: they are flagged
// `provisional` and surface as a warning in every calculation that uses them.

export const REGULATIONS = {
  HWM_2016: { name: 'Hazardous and Other Wastes (Management & Transboundary Movement) Rules, 2016 (as amended)', verified: false },
  SWM_2026: { name: 'Solid Waste Management Rules, 2026 (notified 27 Jan 2026, in force 1 Apr 2026; replace SWM Rules 2016)', verified: true },
  PWM: { name: 'Plastic Waste Management Rules, 2016 (as amended) and EPR guidelines', verified: false },
  EWASTE_2022: { name: 'E-Waste (Management) Rules, 2022', verified: false },
  BATTERY_2022: { name: 'Battery Waste Management Rules, 2022', verified: false },
  BMW_2016: { name: 'Bio-Medical Waste Management Rules, 2016 (as amended)', verified: false },
  CD_2016: { name: 'Construction and Demolition Waste Management Rules, 2016 (check for later revision)', verified: false },
  CPCB_RED_MUD_2024: { name: 'CPCB guidelines for management of red mud from alumina plants (Aug 2024)', verified: false },
};

/** BRSR Principle 6, Essential Indicator on waste: the eight reporting categories. */
export const BRSR_CATEGORIES = {
  plastic: 'Plastic waste (A)',
  e_waste: 'E-waste (B)',
  bio_medical: 'Bio-medical waste (C)',
  construction_demolition: 'Construction and demolition waste (D)',
  battery: 'Battery waste (E)',
  radioactive: 'Radioactive waste (F)',
  other_hazardous: 'Other hazardous waste generated (G)',
  other_non_hazardous: 'Other non-hazardous waste generated (H)',
};

/**
 * ghg: how the class behaves in GHG calculations.
 *   fod:  { doc (fraction of wet waste), kclass }   -> landfill CH4 by first-order decay
 *   incin:{ dm, cf, fcf }                           -> fossil CO2 on incineration/open burning
 *   compostable: biological treatment applicable
 */
export const WASTE_CLASSES = {
  food_organic: { label: 'Food / kitchen / process organics', hazardous: false, brsr: 'other_non_hazardous', compostable: true, fod: { doc: 0.15, kclass: 'rapid' }, incin: { dm: 0.40, cf: 0.38, fcf: 0 } },
  garden: { label: 'Garden / green waste', hazardous: false, brsr: 'other_non_hazardous', compostable: true, fod: { doc: 0.20, kclass: 'moderate' }, incin: { dm: 0.40, cf: 0.49, fcf: 0 } },
  paper_cardboard: { label: 'Paper and cardboard', hazardous: false, brsr: 'other_non_hazardous', compostable: false, fod: { doc: 0.40, kclass: 'slow' }, incin: { dm: 0.90, cf: 0.46, fcf: 0.01 } },
  wood: { label: 'Wood and wood waste', hazardous: false, brsr: 'other_non_hazardous', compostable: false, fod: { doc: 0.43, kclass: 'very_slow' }, incin: { dm: 0.85, cf: 0.50, fcf: 0 } },
  textile: { label: 'Textile / fibre waste', hazardous: false, brsr: 'other_non_hazardous', compostable: false, fod: { doc: 0.24, kclass: 'slow' }, incin: { dm: 0.80, cf: 0.46, fcf: 0.20 } },
  organic_sludge: { label: 'Organic ETP / process sludge (non-hazardous)', hazardous: false, brsr: 'other_non_hazardous', compostable: true, fod: { doc: 0.05, kclass: 'rapid' }, incin: { dm: 0.10, cf: 0.45, fcf: 0 } },
  plastic: { label: 'Plastic waste', hazardous: false, brsr: 'plastic', compostable: false, fod: null, incin: { dm: 1.0, cf: 0.75, fcf: 1.0 } },
  rubber_leather: { label: 'Rubber / leather', hazardous: false, brsr: 'other_non_hazardous', compostable: false, fod: null, incin: { dm: 0.84, cf: 0.67, fcf: 0.20 } },
  metal_scrap: { label: 'Metal scrap / swarf / cut-ends', hazardous: false, brsr: 'other_non_hazardous', compostable: false, fod: null, incin: null },
  inorganic_mineral: { label: 'Inorganic mineral waste (overburden, slag, dust, sand, rejects)', hazardous: false, brsr: 'other_non_hazardous', compostable: false, fod: null, incin: null },
  hazardous_inorganic: { label: 'Hazardous inorganic waste (spent pot lining, dross, metal sludge, spent catalyst)', hazardous: true, brsr: 'other_hazardous', compostable: false, fod: null, incin: null },
  hazardous_organic: { label: 'Hazardous organic waste (solvents, distillation residue, oily sludge)', hazardous: true, brsr: 'other_hazardous', compostable: false, fod: null, incin: { dm: 1.0, cf: null, fcf: 1.0 } },
  used_oil: { label: 'Used / waste oil', hazardous: true, brsr: 'other_hazardous', compostable: false, fod: null, incin: { dm: 1.0, cf: 0.85, fcf: 1.0 } },
  e_waste: { label: 'E-waste', hazardous: true, brsr: 'e_waste', compostable: false, fod: null, incin: null },
  battery: { label: 'Battery waste', hazardous: true, brsr: 'battery', compostable: false, fod: null, incin: null },
  bio_medical: { label: 'Bio-medical waste', hazardous: true, brsr: 'bio_medical', compostable: false, fod: null, incin: null },
  construction_demolition: { label: 'Construction and demolition waste', hazardous: false, brsr: 'construction_demolition', compostable: false, fod: null, incin: null },
};

/** IPCC 2006 Vol.5 Table 3.3 first-order decay rate constants k (1/yr) by climate and decay speed. */
export const FOD_K = {
  tropical_wet: { rapid: 0.40, moderate: 0.17, slow: 0.07, very_slow: 0.035 },
  tropical_dry: { rapid: 0.085, moderate: 0.065, slow: 0.045, very_slow: 0.025 },
};

/** Methane correction factor by landfill type (IPCC 2006 Vol.5 Table 3.1). */
export const MCF = {
  landfill_managed: 1.0, // managed, anaerobic - engineered sanitary landfill / TSDF cell
  landfill_semi_aerobic: 0.5,
  landfill_unmanaged_deep: 0.8, // >= 5 m
  landfill_unmanaged_shallow: 0.4, // < 5 m
  landfill_uncategorised: 0.6,
};

export const FOD_DEFAULTS = { docf: 0.5, f: 0.5, ox: 0, delayMonthsM: 7, horizonYears: 100 };

/** Biological treatment emission factors, g per kg wet waste (IPCC 2006 Vol.5 Table 4.1). */
export const BIOLOGICAL = {
  composting: { CH4: 4, N2O: 0.3 },
  anaerobic_digestion: { CH4: 0.8, N2O: 0 },
};

/** Incineration / open-burning non-CO2 gases, g per tonne wet waste (IPCC 2006 Vol.5 Tables 5.3, 5.6). */
export const THERMAL_NON_CO2 = {
  incineration: { CH4: 0.2, N2O: 50 },
  open_burning: { CH4: 6500, N2O: 150 },
  co_processing: { CH4: 0.2, N2O: 50 },
};

/**
 * Treatment routes. `brsr` places the route in the BRSR recovered/disposed table.
 * `hazardous_ok` encodes whether the route can lawfully take hazardous waste at all
 * (always through an authorised facility under HWM Rules 2016).
 */
export const ROUTES = {
  recycling: { label: 'Recycling by authorised recycler', brsr: 'recycled', hazardous_ok: true, ghg: 'none_gross' },
  reuse: { label: 'Re-use (in-house or sold as input/co-product)', brsr: 'reused', hazardous_ok: false, ghg: 'none_gross' },
  other_recovery: { label: 'Other recovery (e.g. utilisation in cement, bricks, road, backfill)', brsr: 'other_recovery', hazardous_ok: true, ghg: 'none_gross' },
  co_processing: { label: 'Co-processing in cement kiln / power plant', brsr: 'other_recovery', hazardous_ok: true, ghg: 'thermal' },
  composting: { label: 'Composting', brsr: 'other_recovery', hazardous_ok: false, ghg: 'bio' },
  anaerobic_digestion: { label: 'Anaerobic digestion / biomethanation', brsr: 'other_recovery', hazardous_ok: false, ghg: 'bio' },
  incineration: { label: 'Controlled incineration (CPCB-compliant)', brsr: 'incineration', hazardous_ok: true, ghg: 'thermal' },
  open_burning: { label: 'Open burning (not permitted)', brsr: 'other_disposal', hazardous_ok: false, ghg: 'thermal', prohibited: true },
  secure_landfill: { label: 'Secure landfill / TSDF cell', brsr: 'landfill', hazardous_ok: true, ghg: 'landfill', mcf: 'landfill_managed' },
  landfill_managed: { label: 'Sanitary landfill (managed)', brsr: 'landfill', hazardous_ok: false, ghg: 'landfill', mcf: 'landfill_managed' },
  landfill_unmanaged_deep: { label: 'Unmanaged dump, >= 5 m', brsr: 'landfill', hazardous_ok: false, ghg: 'landfill', mcf: 'landfill_unmanaged_deep' },
  landfill_unmanaged_shallow: { label: 'Unmanaged dump, < 5 m', brsr: 'landfill', hazardous_ok: false, ghg: 'landfill', mcf: 'landfill_unmanaged_shallow' },
  engineered_onsite_storage: { label: 'On-site engineered storage / dyke / red-mud pond (authorised)', brsr: 'other_disposal', hazardous_ok: true, ghg: 'none_gross' },
  other_disposal: { label: 'Other disposal', brsr: 'other_disposal', hazardous_ok: false, ghg: 'none_gross' },
};

export const BRSR_RECOVERY = ['recycled', 'reused', 'other_recovery'];
export const BRSR_DISPOSAL = ['incineration', 'landfill', 'other_disposal'];

export const TAXONOMY_STATUS = 'provisional';
