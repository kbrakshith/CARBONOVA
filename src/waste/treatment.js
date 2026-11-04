import { CO2_PER_C } from '../engine/units.js';
import { toCo2e } from '../engine/gwp.js';
import { WASTE_CLASSES, ROUTES, MCF, FOD_K, BIOLOGICAL, THERMAL_NON_CO2 } from './taxonomy.js';
import { fodSeries } from './fod.js';

/**
 * Gross treatment emissions for ONE waste line (tonnes of wet waste x class x route).
 * Avoided emissions from recycling or energy recovery are deliberately NOT netted here:
 * the audit requires gross and avoided figures to be reported separately.
 *
 * Returns { gases: kg by gas, co2eKg, method, assessed, warnings }.
 */
export function treatmentEmissions(line, { gwpSet, reportingYear }) {
  const cls = WASTE_CLASSES[line.waste_class];
  const route = ROUTES[line.route];
  if (!cls) throw new Error(`Unknown waste class "${line.waste_class}"`);
  if (!route) throw new Error(`Unknown treatment route "${line.route}"`);
  const t = line.tonnes_wet;
  const warnings = [];
  const gases = {};
  let method;
  let assessed = true;
  let detail = null;

  switch (route.ghg) {
    case 'none_gross':
      method = `No gross treatment emissions modelled for "${route.label}" (transport and reprocessing energy are outside this boundary; avoided burden not netted).`;
      break;

    case 'landfill': {
      if (!cls.fod) {
        method = `${cls.label}: no biodegradable carbon, so IPCC FOD gives no CH4. Mass is still reported.`;
        break;
      }
      const climate = line.climate ?? 'tropical_wet';
      if (!line.climate) warnings.push({ code: 'CLIMATE_DEFAULT', message: 'Facility rainfall not given: assumed tropical wet (k from IPCC Table 3.3). Provide annual rainfall (mm) for the disposal site.' });
      const k = FOD_K[climate][cls.fod.kclass];
      const mcf = MCF[route.mcf];
      const res = fodSeries({
        deposits: [...(line.history ?? []), { year: reportingYear, tonnes: t }],
        doc: cls.fod.doc, k, mcf, recoveredFraction: line.methane_recovered_fraction ?? 0, ox: line.oxidation_factor ?? 0,
      });
      // Scope 3 cat 5 convention: all future emissions from waste generated this year. Prior-year history
      // (if supplied) is excluded from the lifetime figure of the current deposit.
      const own = fodSeries({ deposits: [{ year: reportingYear, tonnes: t }], doc: cls.fod.doc, k, mcf, recoveredFraction: line.methane_recovered_fraction ?? 0, ox: line.oxidation_factor ?? 0 });
      gases.CH4 = own.totalCh4T * 1000;
      method = `IPCC 2006 Vol.5 first-order decay: DOC ${cls.fod.doc}, k ${k}/yr (${climate}, ${cls.fod.kclass}), MCF ${mcf}, DOCf 0.5, F 0.5; lifetime CH4 of waste generated in ${reportingYear}; in-year CH4 ${(own.firstYearCh4T * 1000).toFixed(2)} kg.`;
      detail = { inYearCh4Kg: own.firstYearCh4T * 1000, lifetimeCh4Kg: gases.CH4, withHistoryCh4Kg: res.totalCh4T * 1000 };
      break;
    }

    case 'bio': {
      if (!cls.compostable) {
        warnings.push({ code: 'ROUTE_CLASS_MISMATCH', severity: 'error', message: `${cls.label} is not suitable for ${route.label}.` });
        assessed = false;
        method = 'Not assessed: class unsuitable for route.';
        break;
      }
      const ef = BIOLOGICAL[line.route];
      gases.CH4 = t * ef.CH4; // g/kg wet == kg/t wet
      if (ef.N2O) gases.N2O = t * ef.N2O;
      method = `IPCC 2006 Vol.5 Table 4.1 default (wet basis): CH4 ${ef.CH4} g/kg, N2O ${ef.N2O} g/kg. Reported route-specific, not blended.`;
      break;
    }

    case 'thermal': {
      const non = THERMAL_NON_CO2[line.route];
      gases.CH4 = (t * non.CH4) / 1000;
      gases.N2O = (t * non.N2O) / 1000;
      if (cls.incin) {
        const cf = line.carbon_fraction_override ?? cls.incin.cf;
        if (cf == null) {
          assessed = false;
          warnings.push({ code: 'CARBON_FRACTION_MISSING', severity: 'warning', message: `${cls.label} incinerated: provide carbon fraction (lab analysis) to compute fossil CO2. CO2 not assessed.` });
        } else {
          const dm = line.dry_matter_fraction ?? cls.incin.dm;
          gases.CO2 = t * 1000 * dm * cf * cls.incin.fcf * 1.0 * CO2_PER_C; // OF = 1 (IPCC default)
        }
        method = `Fossil CO2 = W x dm ${line.dry_matter_fraction ?? cls.incin.dm} x CF ${cf ?? 'n/a'} x FCF ${cls.incin.fcf} x OF 1 x 44/12; CH4/N2O per IPCC Vol.5 for ${line.route}. Biogenic CO2 excluded from totals.`;
      } else {
        method = `${cls.label} has no combustible carbon in this model; only CH4/N2O trace gases counted.`;
      }
      if (route.prohibited) warnings.push({ code: 'PROHIBITED_ROUTE', severity: 'error', message: 'Open burning of waste is not a permitted route.' });
      break;
    }
    default:
      throw new Error(`Route ghg type ${route.ghg} not handled`);
  }

  return { gases, co2eKg: toCo2e(gases, gwpSet), method, assessed, warnings, detail };
}
