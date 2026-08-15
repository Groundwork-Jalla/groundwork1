import type { FixturePrices, WizardFormData } from '@/types/project';
import { DEFAULT_FIXTURE_PRICES } from './model';
import { countBathrooms, countKitchens } from './geometry';

/**
 * Sanitary fixture schedule.
 *
 * The four BQs price plumbing as a fixture list, not as a percentage of anything, and the
 * arithmetic reproduces exactly:
 *
 *   Buea    2,255,000   Rose 6,450,000   Naka 2,255,000   Mpangou 10,955,000
 *
 * Which fixtures appear is what actually separates a standard build from a premium one.
 * Buea (standard) has WCs and sinks only — no mirrors, no showers, no kitchen sink, no
 * bath. Rose (premium) has all of those plus two baths.
 */
export interface FixtureSchedule {
  wc: number;
  sink: number;
  mirror: number;
  shower: number;
  kitchenSink: number;
  tub: number;
}

export function fixtureSchedule(data: Partial<WizardFormData>): FixtureSchedule {
  const baths    = countBathrooms(data);
  const kitchens = countKitchens(data);
  const finish   = data.finishLevel ?? 'standard';
  const floors   = Math.max(1, Math.round(data.floors ?? 1));

  // A multi-family block repeats its wet core on every floor.
  const units = data.buildingType === 'multi_family' ? floors : 1;

  const aboveStandard = finish === 'premium' || finish === 'luxury';

  return {
    wc:          baths,
    sink:        baths,
    mirror:      aboveStandard ? baths : 0,
    shower:      aboveStandard ? baths * units : 0,
    kitchenSink: aboveStandard ? kitchens : 0,
    tub:         finish === 'luxury'  ? Math.floor((baths * units) / 2)
               : finish === 'premium' ? Math.min(2, baths)
               : 0,
  };
}

/**
 * Section 800 as BQ lines — the four installation items plus one line per fixture type.
 *
 * Rates are UNINDEXED: the caller multiplies by the city index, exactly as the old
 * `plumbingCost(...) * ci` did. Returning indexed rates here would double-apply it.
 */
export function plumbingLines(
  data: Partial<WizardFormData>,
  prices: Partial<FixturePrices> | null | undefined,
): { code: '801' | '802' | '803' | '804' | '805' | '806' | '807' | '808' | '809' | '810'; qty: number; rate: number }[] {
  const p = { ...DEFAULT_FIXTURE_PRICES, ...(prices ?? {}) };
  const f = fixtureSchedule(data);
  return [
    { code: '801', qty: 1,              rate: p.supply       },
    { code: '802', qty: 1,              rate: p.drainage     },
    { code: '803', qty: 1,              rate: p.septic       },
    { code: '804', qty: 1,              rate: p.accessories  },
    { code: '805', qty: f.wc,           rate: p.wc           },
    { code: '806', qty: f.sink,         rate: p.sink         },
    { code: '807', qty: f.mirror,       rate: p.mirror       },
    { code: '808', qty: f.shower,       rate: p.shower       },
    { code: '809', qty: f.tub,          rate: p.tub          },
    { code: '810', qty: f.kitchenSink,  rate: p.kitchen_sink },
  ];
}

/**
 * Section 800 total, in local currency.
 *
 * Kept as the sum of `plumbingLines` rather than its own expression — the old version was
 * a separate arithmetic statement, and PLUMBING_CHECKS asserted against a formula the
 * test recomputed in its own body rather than against the engine.
 */
export function plumbingCost(
  data: Partial<WizardFormData>,
  prices: Partial<FixturePrices> | null | undefined,
): number {
  return plumbingLines(data, prices).reduce((s, l) => s + l.qty * l.rate, 0);
}
