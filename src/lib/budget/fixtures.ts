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

/** Section 800 — Plumbing and sanitary fixtures, in local currency. */
export function plumbingCost(
  data: Partial<WizardFormData>,
  prices: Partial<FixturePrices> | null | undefined,
): number {
  const p = { ...DEFAULT_FIXTURE_PRICES, ...(prices ?? {}) };
  const f = fixtureSchedule(data);
  return p.supply + p.drainage + p.septic + p.accessories
       + f.wc * p.wc
       + f.mirror * p.mirror
       + f.sink * p.sink
       + f.tub * p.tub
       + f.shower * p.shower
       + f.kitchenSink * p.kitchen_sink;
}
