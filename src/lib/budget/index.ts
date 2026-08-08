import type {
  BudgetBreakdown, BudgetCalcDetail, CityRate, ConstructionRate,
  ProjectRow, TradeSection, WizardFormData,
} from '@/types/project';
import { runTakeoff, SECTION_KEYS, type SectionKey } from './engine';
import { BQ_ROOM_COST_USD, buildLegacyRate, legacyTotal } from './legacy';
import { formatMoney } from '@/lib/format';
// Type-only: erased at build, and nothing under @/lib/i18n imports @/lib/budget,
// so this cannot create a cycle.
import type { TKey } from '@/lib/i18n/translate';

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
  return splitBudget(calculateTotal(data, rate, cityRate));
}

/**
 * Split `units` across `weights` so the parts sum to `units` EXACTLY.
 *
 * Largest-remainder (Hare quota): floor every share, then hand the shortfall to the
 * largest fractional remainders one unit at a time. `Array.prototype.sort` is
 * specified as stable, so ties break on declaration order — for `BUDGET_SPLIT_PCT`
 * that means the biggest slice absorbs a tied cent.
 *
 * Six independent `Math.round` calls used to drift the parts up to $2 away from the
 * total they were printed beneath. There is no rounding rule that avoids that; the
 * remainder has to be allocated deliberately, which is what this does.
 */
function allocate<K extends string>(units: number, weights: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const out  = Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>;

  const totalWeight = keys.reduce((sum, k) => sum + Math.max(0, weights[k]), 0);
  if (!Number.isFinite(units) || units <= 0 || totalWeight <= 0) return out;

  const rounded = Math.round(units);
  const rems: { key: K; rem: number }[] = [];
  let assigned = 0;

  for (const k of keys) {
    const exact = rounded * Math.max(0, weights[k]) / totalWeight;
    const base  = Math.floor(exact);
    out[k] = base;
    assigned += base;
    rems.push({ key: k, rem: exact - base });
  }

  // Stable sort keeps declaration order for equal remainders.
  rems.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < rounded - assigned; i++) out[rems[i].key] += 1;

  return out;
}

/**
 * The canonical six-way breakdown of a budget.
 *
 * Works in integer CENTS, because `budget_usd` is NUMERIC(14,2) and money is rendered
 * to two decimal places. For a whole-dollar total — which is every total the app
 * produces, since both `calculateTotal` and `legacyTotal` round — each share is an
 * exact number of cents and no remainder distribution is needed at all.
 *
 * Returns the SNAPPED total, not the input. That is load-bearing: parts and total come
 * out of one object, so a component rendering `b.total` beside `b.materials` cannot
 * show two figures that disagree.
 */
export function splitBudget(total: number): BudgetBreakdown {
  const cents = Number.isFinite(total) && total > 0 ? Math.round(total * 100) : 0;
  const parts = allocate(cents, BUDGET_SPLIT_PCT);
  return {
    total:       cents / 100,
    materials:   parts.materials   / 100,
    labor:       parts.labor       / 100,
    engineering: parts.engineering / 100,
    permits:     parts.permits     / 100,
    contingency: parts.contingency / 100,
    management:  parts.management  / 100,
  };
}

/**
 * The breakdown for a saved project — the ONLY way a `ProjectRow` should get one.
 *
 * A project has exactly one budget: `budget_usd`, the figure the owner confirmed when
 * tracking started. The engine estimate is a fallback for rows created before that
 * confirmation, nothing more.
 *
 * Never pair `project.budget_usd` with a breakdown from `calculateBudget` — that was
 * the bug this replaces. The costing tab printed slices of the *estimate* underneath
 * the *confirmed* total, so "41% x total = materials" was arithmetically false for
 * anyone who edited their budget.
 */
export function projectBudget(
  project: ProjectBudgetSource,
  rate?: ConstructionRate | null,
  cityRate?: CityRate | null,
): BudgetBreakdown {
  if (project.budget_usd != null) return splitBudget(project.budget_usd);

  return splitBudget(calculateTotal({
    country:         project.country,
    city:            project.city ?? undefined,
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  }, rate, cityRate));
}

/** The fields of a `ProjectRow` that pricing actually reads. */
export type ProjectBudgetSource = Pick<ProjectRow,
  | 'country' | 'city' | 'num_floors' | 'building_type' | 'roof_type'
  | 'has_boys_quarters' | 'bq_rooms' | 'sqm' | 'finish_level' | 'budget_usd'>;

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

/**
 * Display order and labels for the six-way split.
 *
 * Three components and the PDF each kept their own copy of this array with the
 * percentages typed out as literals. Import this instead — a percentage that lives in
 * two places is a percentage that will eventually disagree with itself.
 */
export const BUDGET_SLICES = [
  { key: 'materials',   labelKey: 'project.costing.sliceMaterials',   pct: BUDGET_SPLIT_PCT.materials   },
  { key: 'labor',       labelKey: 'project.costing.sliceLabor',       pct: BUDGET_SPLIT_PCT.labor       },
  { key: 'engineering', labelKey: 'project.costing.sliceEngineering', pct: BUDGET_SPLIT_PCT.engineering },
  { key: 'management',  labelKey: 'project.costing.sliceManagement',  pct: BUDGET_SPLIT_PCT.management  },
  { key: 'contingency', labelKey: 'project.costing.sliceContingency', pct: BUDGET_SPLIT_PCT.contingency },
  { key: 'permits',     labelKey: 'project.costing.slicePermits',     pct: BUDGET_SPLIT_PCT.permits     },
] as const satisfies readonly {
  key: Exclude<keyof BudgetBreakdown, 'total'>;
  labelKey: TKey;
  pct: number;
}[];

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
        pct:         0, // assigned by finalizeSections
        amountUSD:   usd,
        amountLocal: local,
        color:       SECTION_COLORS[key] ?? '#9ca3af',
      });
    }
    pushBoysQuarters(sections, data, bqUSD, fx);
    finalizeSections(sections, total, fx);
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

  // `pct` is deliberately NOT passed in. It used to be, and the eight base sections
  // passed a share of `singleBase` while `upper_floor` and `bq` passed a share of
  // `total` — two different denominators in one column, which summed to 118.7% on a
  // two-storey build. Percentages are now derived from the amounts, once, below.
  const add = (key: string, label: string, usd: number) => {
    if (usd <= 0) return;
    sections.push({
      key, label,
      pct:         0, // assigned by finalizeSections
      amountUSD:   usd,
      amountLocal: usd * fx,
      color:       SECTION_COLORS[key] ?? '#9ca3af',
    });
  };

  add('preliminary',  SECTION_LABELS.preliminary,  singleBase * secs.preliminary  / 100);
  add('foundation',   SECTION_LABELS.foundation,   singleBase * secs.foundation   / 100);
  add('ground_floor', SECTION_LABELS.ground_floor, singleBase * secs.ground_floor / 100);
  add('roof',         SECTION_LABELS.roof,         singleBase * secs.roof         / 100);
  add('joinery',      SECTION_LABELS.joinery,      singleBase * secs.joinery      / 100);
  add('electrical',   SECTION_LABELS.electrical,   singleBase * secs.electrical   / 100);
  add('plumbing',     SECTION_LABELS.plumbing,     singleBase * secs.plumbing     / 100);
  add('finishing',    SECTION_LABELS.finishing,    singleBase * secs.finishing    / 100);

  for (let f = 1; f <= extraFloors; f++) {
    const floorUSD = singleBase * (effective.upper_floor_addition_pct / 100);
    add('upper_floor',
        extraFloors === 1 ? SECTION_LABELS.upper_floor : `Floor ${f + 1} Structure`,
        floorUSD);
  }
  pushBoysQuarters(sections, data, bqUSD, fx);
  finalizeSections(sections, total, fx);

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
  bqUSD: number, fx: number,
): void {
  if (bqUSD <= 0) return;
  const n = data.bqRooms ?? 0;
  sections.push({
    key:   'bq',
    label: `Boys' Quarters (${n} room${n > 1 ? 's' : ''})`,
    pct:   0, // assigned by finalizeSections
    amountUSD:   bqUSD,
    amountLocal: bqUSD * fx,
    color:       SECTION_COLORS.bq,
  });
}

/**
 * Round the section amounts and derive their percentages, in one pass, from a single
 * denominator.
 *
 * Both are allocated rather than rounded independently, so the amount column sums to
 * `total` exactly and the percentage column sums to exactly 100.0 — the two things a
 * reader checks first when a quotation is laid beside an estimate.
 *
 * Allocation is keyed on array INDEX, not `section.key`: a build with three upper
 * floors emits `upper_floor` three times, and a key-based map would silently collapse
 * them into one.
 */
function finalizeSections(sections: TradeSection[], total: number, fx: number): void {
  if (sections.length === 0) return;

  const weights = Object.fromEntries(
    sections.map((s, i) => [String(i), Math.max(0, s.amountUSD)]),
  ) as Record<string, number>;

  const cents = allocate(Math.round(total * 100), weights);
  const tenths = allocate(1000, weights);

  sections.forEach((s, i) => {
    const usd = cents[String(i)] / 100;
    s.amountUSD   = usd;
    s.amountLocal = Math.round(usd * fx);
    s.pct         = tenths[String(i)] / 10;
  });
}

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
