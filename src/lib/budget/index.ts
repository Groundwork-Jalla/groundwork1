import type {
  BudgetBreakdown, BudgetCalcDetail, CityRate, ConstructionRate,
  TradeSection, WizardFormData,
} from '@/types/project';
import { runTakeoff, SECTION_KEYS, type SectionKey } from './engine';
import { BQ_ROOM_COST_USD, buildLegacyRate, legacyTotal } from './legacy';
import { formatMoney } from '@/lib/format';

export { CITY_RATES, CM_CITY_CODES, CM_TAKEOFF, resolveCityRate, BASELINE_CITY } from './model';
export { fixtureSchedule, plumbingCost } from './fixtures';
export { deriveQuantities, countRooms } from './geometry';
export { runTakeoff, SECTION_KEYS } from './engine';
export type { SectionKey } from './engine';

// ── Trade section display colours ──────────────────────────
const SECTION_COLORS: Record<string, string> = {
  preliminary:  '#94a3b8', // slate
  foundation:   '#78716c', // stone
  ground_floor: '#3b82f6', // blue
  upper_floor:  '#60a5fa', // blue-light
  roof:         '#f59e0b', // amber
  joinery:      '#8b5cf6', // purple
  electrical:   '#eab308', // yellow
  plumbing:     '#06b6d4', // cyan
  finishing:    '#22c55e', // green
  bq:           '#f97316', // orange
};

/** English fallbacks. Translated consumers should key off `section.key` instead. */
const SECTION_LABELS: Record<SectionKey, string> = {
  preliminary:  'Site & Preliminary',
  foundation:   'Foundation',
  ground_floor: 'Ground Floor Structure',
  upper_floor:  'Upper Floor Structure',
  roof:         'Roof & Covering',
  joinery:      'Doors & Windows',
  electrical:   'Electrical',
  plumbing:     'Plumbing & Sanitary',
  finishing:    'Finishing & Painting',
};

/**
 * Total project cost in USD.
 *
 * Uses the quantity take-off when the country has a model (Cameroon today) and falls back
 * to the legacy multiplicative formula otherwise. `data.sqm` is the GROUND FLOOR
 * FOOTPRINT — see geometry.ts for why that distinction matters.
 */
export function calculateBudget(
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
  cityRate?: CityRate | null,
): BudgetBreakdown {
  const total = calculateTotal(data, rate, cityRate);
  const pct = (p: number) => Math.round(total * p / 100);
  return {
    total,
    materials:   pct(BUDGET_SPLIT_PCT.materials),
    labor:       pct(BUDGET_SPLIT_PCT.labor),
    engineering: pct(BUDGET_SPLIT_PCT.engineering),
    permits:     pct(BUDGET_SPLIT_PCT.permits),
    contingency: pct(BUDGET_SPLIT_PCT.contingency),
    management:  pct(BUDGET_SPLIT_PCT.management),
  };
}

/**
 * The six-way cost split, as percentages. `calculateBudget` is the only place these are
 * applied; everything that displays a split must read from here rather than restate them.
 *
 * Four different splits used to coexist. Two of them disagreed with the amounts they were
 * labelling — the Overview donut showed 9% permits beside a figure that was 10% of the
 * total, and 27% fees beside a figure that was 26%.
 */
export const BUDGET_SPLIT_PCT = {
  materials:   41,
  labor:       23,
  engineering: 16,
  management:  10,
  contingency:  8,
  permits:      2,
} as const;

/**
 * Four-way roll-up for the summary donuts, derived from the six-way split so the two can
 * never drift apart. Professional fees are engineering + management; permits are grouped
 * with contingency, matching how the Overview tab already computes its amounts.
 */
export const BUDGET_ROLLUP_PCT = {
  materials: BUDGET_SPLIT_PCT.materials,
  labor:     BUDGET_SPLIT_PCT.labor,
  fees:      BUDGET_SPLIT_PCT.engineering + BUDGET_SPLIT_PCT.management,
  permits:   BUDGET_SPLIT_PCT.permits + BUDGET_SPLIT_PCT.contingency,
} as const;

export function rollupBudget(b: BudgetBreakdown) {
  return {
    materials: b.materials,
    labor:     b.labor,
    fees:      b.engineering + b.management,
    permits:   b.permits + b.contingency,
  };
}

function calculateTotal(
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
  cityRate?: CityRate | null,
): number {
  const effective = rate ?? buildLegacyRate(data);
  const takeoff   = runTakeoff(data, effective, cityRate);

  if (takeoff) {
    const usd    = takeoff.totalLocal / effective.approx_fx_rate;
    const bqCost = data.hasBoysQuarters && (data.bqRooms ?? 0) > 0
      ? (data.bqRooms ?? 0) * BQ_ROOM_COST_USD
      : 0;
    return Math.round(usd + bqCost);
  }
  return legacyTotal(data, effective);
}

/**
 * Per-section detail for the wizard summary and the project costing tab.
 *
 * With a take-off model the sections are the nine a Cameroonian BQ is actually written
 * in, so a Groundwork estimate can be laid beside a real quotation line for line. Without
 * one it falls back to slicing the legacy total by the stored percentages.
 */
export function calculateBudgetDetail(
  data: Partial<WizardFormData>,
  rate?: ConstructionRate | null,
  cityRate?: CityRate | null,
): BudgetCalcDetail {
  const effective = rate ?? buildLegacyRate(data);
  const fx        = effective.approx_fx_rate;
  const takeoff   = runTakeoff(data, effective, cityRate);
  const sections: TradeSection[] = [];

  const bqUSD = data.hasBoysQuarters && (data.bqRooms ?? 0) > 0
    ? (data.bqRooms ?? 0) * BQ_ROOM_COST_USD
    : 0;

  if (takeoff) {
    const total = Math.round(takeoff.totalLocal / fx) + bqUSD;
    for (const key of SECTION_KEYS) {
      const local = takeoff.sectionsLocal[key];
      if (local <= 0) continue;
      const usd = local / fx;
      sections.push({
        key,
        label:       SECTION_LABELS[key],
        pct:         round1((usd / total) * 100),
        amountUSD:   Math.round(usd),
        amountLocal: Math.round(local),
        color:       SECTION_COLORS[key] ?? '#9ca3af',
      });
    }
    pushBoysQuarters(sections, data, bqUSD, total, fx);
    return {
      sections, total,
      totalLocal:   Math.round(total * fx),
      currencyCode: effective.currency_code,
      approxFxRate: fx,
      dataSource:   effective.data_source,
    };
  }

  // ── Legacy path ──
  const total       = legacyTotal(data, effective);
  const extraFloors = Math.max(0, (data.floors ?? 1) - 1);
  const secs        = effective.sections;
  const finishMult  = effective.finish_multipliers[data.finishLevel ?? 'standard']            ?? 1.0;
  const buildMult   = effective.building_type_multipliers[data.buildingType ?? '']            ?? 1.0;
  const roofMult    = effective.roof_type_multipliers[data.roofType ?? '']                    ?? 1.0;
  const singleBase  = (data.sqm ?? 0) * effective.base_rate_usd * finishMult * buildMult * roofMult;

  const add = (key: string, label: string, pct: number, usd: number) => {
    if (usd <= 0) return;
    sections.push({
      key, label,
      pct:         round1(pct),
      amountUSD:   Math.round(usd),
      amountLocal: Math.round(usd * fx),
      color:       SECTION_COLORS[key] ?? '#9ca3af',
    });
  };

  add('preliminary',  SECTION_LABELS.preliminary,  secs.preliminary,  singleBase * secs.preliminary  / 100);
  add('foundation',   SECTION_LABELS.foundation,   secs.foundation,   singleBase * secs.foundation   / 100);
  add('ground_floor', SECTION_LABELS.ground_floor, secs.ground_floor, singleBase * secs.ground_floor / 100);
  add('roof',         SECTION_LABELS.roof,         secs.roof,         singleBase * secs.roof         / 100);
  add('joinery',      SECTION_LABELS.joinery,      secs.joinery,      singleBase * secs.joinery      / 100);
  add('electrical',   SECTION_LABELS.electrical,   secs.electrical,   singleBase * secs.electrical   / 100);
  add('plumbing',     SECTION_LABELS.plumbing,     secs.plumbing,     singleBase * secs.plumbing     / 100);
  add('finishing',    SECTION_LABELS.finishing,    secs.finishing,    singleBase * secs.finishing    / 100);

  for (let f = 1; f <= extraFloors; f++) {
    const floorUSD = singleBase * (effective.upper_floor_addition_pct / 100);
    add('upper_floor',
        extraFloors === 1 ? SECTION_LABELS.upper_floor : `Floor ${f + 1} Structure`,
        (floorUSD / total) * 100, floorUSD);
  }
  pushBoysQuarters(sections, data, bqUSD, total, fx);

  return {
    sections, total,
    totalLocal:   Math.round(total * fx),
    currencyCode: effective.currency_code,
    approxFxRate: fx,
    dataSource:   effective.data_source,
  };
}

function pushBoysQuarters(
  sections: TradeSection[], data: Partial<WizardFormData>,
  bqUSD: number, total: number, fx: number,
): void {
  if (bqUSD <= 0) return;
  const n = data.bqRooms ?? 0;
  sections.push({
    key:   'bq',
    label: `Boys' Quarters (${n} room${n > 1 ? 's' : ''})`,
    pct:   round1((bqUSD / total) * 100),
    amountUSD:   Math.round(bqUSD),
    amountLocal: Math.round(bqUSD * fx),
    color:       SECTION_COLORS.bq,
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Formatting helpers ─────────────────────────────────────
//
// Foundations v1: "Cents are always shown. A figure that drops them looks estimated,
// and nothing on a money screen is estimated."
//
// formatUSD used to abbreviate to $42K / $1.23M. It no longer does, which makes it
// identical to formatUSDFull — both are kept so the ~100 existing call sites compile,
// but there is now one behaviour, not two. Prefer `useFormat()` from '@/lib/i18n' in
// components: these read a module-level locale and so will not re-render on their own
// when the language toggles.

export function formatUSD(amount: number): string {
  return formatMoney(amount, 'USD');
}

/** @deprecated Identical to `formatUSD` since the cents rule landed. */
export function formatUSDFull(amount: number): string {
  return formatMoney(amount, 'USD');
}

export function formatLocalCurrency(amount: number, currencyCode: string): string {
  return formatMoney(amount, currencyCode);
}
