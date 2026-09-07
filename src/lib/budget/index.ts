import type {
  BudgetBreakdown, BudgetCalcDetail, CityRate, ConstructionRate,
  ProjectRow, TradeSection, WizardFormData,
} from '@/types/project';
import { runTakeoff, SECTION_KEYS, type SectionKey } from './engine';
import { buildLegacyRate, getApproxFx, legacyTotal } from './legacy';
import { buildDurationMonths } from './timeline';
import { formatMoney } from '@/lib/format';
// Type-only: erased at build, and nothing under @/lib/i18n imports @/lib/budget,
// so this cannot create a cycle.
import type { TKey } from '@/lib/i18n/translate';

export { CITY_RATES, CM_CITY_CODES, CM_TAKEOFF, resolveCityRate, BASELINE_CITY, hasLocalBq } from './model';
export { fixtureSchedule, plumbingCost } from './fixtures';
export { deriveQuantities, countRooms, countOpenings, hasFloorRooms } from './geometry';
export type { DetailedTakeoffInput, Quantities } from './geometry';
export {
  applyOverrides, sectionsFromLines, totalFromLines,
} from './lines';
export type { TakeoffLine, LineOverride, OverrideMap, LineKind } from './lines';
export { BQ_ITEMS, bqItem } from './bq-items';
export type { BqCode, BqItem } from './bq-items';
export { runTakeoff, SECTION_KEYS } from './engine';
export { buildLegacyRate, getApproxFx, getCurrencyCode } from './legacy';
export { ROOF_OPTIONS, ROOF_FORMS, isFlatRoof, roofOption, roofsOfForm, roofMultipliers } from './roof';
/**
 * Build duration, per Vanessa's rule of 4 Sep 2026. Re-exported here because the fee
 * formulas bill by the month, so length and cost are now one calculation and not two.
 */
export {
  buildDurationDays, buildDurationMonths, stageDurationDays,
  BUNGALOW_DAYS, DAYS_PER_UPPER_FLOOR,
} from './timeline';
export type { RoofForm, RoofOption } from './roof';
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
  const effective = rate ?? buildLegacyRate(data);
  return composeBudget(
    calculateTotal(data, effective, cityRate),
    shapeOf(data.sqm, data.floors),
  );
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

// ── The four-line client budget ────────────────────────────
//
// Everything below works in integer CENTS. `budget_usd` is NUMERIC(14,2) and money is
// rendered to two places, so cents is the unit in which "the parts add up" is decidable
// at all. Converting to dollars happens once, at the end, in `assemble`.

/** Share of the construction fee that is material. Display only — it does not add cost. */
export const MATERIAL_PCT = 60;
/** Share of the construction fee that is labour. `MATERIAL_PCT + LABOR_PCT === 100`. */
export const LABOR_PCT = 40;
/**
 * Permit fee, as a percentage of the construction fee. Charged ON TOP of it.
 *
 * Was 1% — the figure paid to government. Vanessa Gwanvoma's review (17 Aug 2026) is
 * that 1% is only the government line: before it there are council site visits, and
 * environmental-safety and fire-service compliance documents whose cost varies by city
 * and building type. Her figure from real projects is 2-2.5% of construction; 2.25 is
 * the mid-point, chosen by Favour.
 *
 * Existing projects are NOT re-priced. `project_fees.amount_usd` is written once at
 * tracking start and a permit line someone already agreed to must not move under them —
 * the same rule migration 020 gives for refusing to backfill `budget_usd`.
 */
export const PERMIT_PCT_OF_BUILD = 2.25;
/**
 * Verification, per charged construction stage.
 *
 * This is the 50,000 XAF an independent professional is paid to go and confirm a stage is
 * genuinely finished before the milestone is released. It was called the *professional*
 * fee until 4 Sep 2026, which was a misnomer: Philip and Vanessa established that
 * verification is its own category and the professional fee is four named roles (below).
 * Same number, honest name, and now its own line on the client's breakdown.
 */
export const VERIFICATION_FEE_XAF = 50_000;

/** Design fee, per built m² (footprint × floors). Confirmed correct by Vanessa, 4 Sep. */
export const DESIGN_RATE_XAF_PER_M2 = 5_000;

/**
 * The four professional roles, from Vanessa on 4 Sep 2026.
 *
 * Previously one flat line of 350,000 XAF for every project regardless of size or length,
 * which is why an eight-storey block and a bungalow were charged the same for
 * supervision. Two of the four now scale with the *duration* of the build, which is what
 * ties this to `timeline.ts` — get the months wrong and these are wrong.
 *
 * A site *engineer* is deliberately not here: that sits inside the 40% labour split, as
 * both Philip and Vanessa confirmed on the call.
 */
export const SITE_MANAGER_XAF_PER_MONTH      = 300_000;
export const QUANTITY_SURVEYOR_XAF_PER_MONTH = 55_000;
/** One contract per project — Vanessa: "just one contract", raised from 50,000. */
export const CONTRACT_LAWYER_XAF             = 100_000;
/** The project manager takes a share of the build rather than a monthly rate. */
export const PROJECT_MANAGER_PCT_OF_BUILD    = 5;

/**
 * Contingency, on everything else.
 *
 * 2%, from Vanessa: council permit variations, coastal painting requirements, and
 * unpredictable ground water tables — the things that reliably happen on a Cameroonian
 * site and are never in anyone's first estimate.
 *
 * NOTE: the 3 Sep meeting said 5%, and backlog items B2/F19 still say so. The 4 Sep
 * figure supersedes it: that was Philip alone; this was Philip with the engineer.
 */
export const CONTINGENCY_PCT = 2;
/**
 * Stages that carry a non-zero share of the construction fee.
 *
 * The verification fee is `VERIFICATION_FEE_XAF × CHARGED_STAGE_COUNT` — one site visit
 * per charged stage — so this is not a free-floating number. stage-seeds.test.ts asserts
 * the pipeline really does have this many charged stages, which is what stops a stage
 * being added later without a visit being paid for.
 */
export const CHARGED_STAGE_COUNT = 7;

/**
 * Both flat fees are quoted in XAF and are the same in every country — they are
 * Groundwork's own pricing, not a local construction cost. So they convert at the XAF
 * rate wherever the project is, rather than at the project country's rate, which would
 * make a Nigerian client's professional fee $218 and a Kenyan's $2,692 for identical work.
 */
const XAF_PER_USD = getApproxFx('CM');

const toCents = (usd: number) =>
  Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : 0;

const xafToCents = (xaf: number) => Math.round(xaf / XAF_PER_USD * 100);

/**
 * The fee lines that do NOT depend on the construction fee. In cents.
 *
 * Everything here is a function of size or duration only, which is what keeps
 * `decomposeBudget` a one-line inversion — see the algebra there. The project manager is
 * deliberately absent: 5% of the build is not flat, so it belongs in `assemble`.
 */
function flatFeeCents(builtAreaSqm: number, floors: number) {
  const area   = Number.isFinite(builtAreaSqm) && builtAreaSqm > 0 ? builtAreaSqm : 0;
  const months = buildDurationMonths(floors);

  return {
    design:            xafToCents(DESIGN_RATE_XAF_PER_M2 * area),
    siteManager:       xafToCents(SITE_MANAGER_XAF_PER_MONTH * months),
    quantitySurveyor:  xafToCents(QUANTITY_SURVEYOR_XAF_PER_MONTH * months),
    contractLawyer:    xafToCents(CONTRACT_LAWYER_XAF),
    verification:      xafToCents(VERIFICATION_FEE_XAF * CHARGED_STAGE_COUNT),
  };
}

/**
 * The four professional roles, itemised, in USD.
 *
 * `BudgetBreakdown.professional` is their sum — one client-facing line, as it has always
 * been. This is for the "how is this calculated" expander, because Philip's actual ask was
 * transparency: a client should see who they are paying, not a single opaque figure.
 */
export interface ProfessionalParts {
  siteManager: number;
  quantitySurveyor: number;
  contractLawyer: number;
  projectManager: number;
  /** Build duration in months — what the first two are multiplied by. */
  months: number;
}

export function professionalParts(constructionUSD: number, floors: number): ProfessionalParts {
  const flat = flatFeeCents(0, floors);
  return {
    siteManager:      flat.siteManager      / 100,
    quantitySurveyor: flat.quantitySurveyor / 100,
    contractLawyer:   flat.contractLawyer   / 100,
    projectManager:   Math.round(toCents(constructionUSD) * PROJECT_MANAGER_PCT_OF_BUILD / 100) / 100,
    months:           buildDurationMonths(floors),
  };
}

/**
 * Build the breakdown from a construction fee, in cents.
 *
 * `overrideTotalCents` is how `decomposeBudget` keeps the owner's confirmed total exactly
 * intact: the rounding remainder is pushed into the permit line rather than allowed to
 * move the total. A cent of drift on a permit fee is invisible; a cent of drift on the
 * number someone agreed to pay is the bug this whole module exists to prevent.
 */
function assemble(
  constructionCentsIn: number,
  shape: BudgetShape,
  overrideTotalCents?: number,
): BudgetBreakdown {
  let constructionCents = constructionCentsIn;
  const flat  = flatFeeCents(shape.builtAreaSqm, shape.floors);
  const parts = allocate(constructionCents, { material: MATERIAL_PCT, labor: LABOR_PCT });

  let permit = Math.round(constructionCents * PERMIT_PCT_OF_BUILD / 100);

  // The project manager is the one professional paid out of the build rather than by the
  // month, so it belongs here and not in flatFeeCents.
  const projectManager = Math.round(constructionCents * PROJECT_MANAGER_PCT_OF_BUILD / 100);
  const professional   = flat.siteManager + flat.quantitySurveyor
                       + flat.contractLawyer + projectManager;

  // Contingency is on everything else, so it is computed last and is the only line whose
  // basis is the subtotal rather than the construction fee.
  const subtotal    = constructionCents + permit + professional
                    + flat.design + flat.verification;
  const contingency = Math.round(subtotal * CONTINGENCY_PCT / 100);

  let total = subtotal + contingency;

  if (overrideTotalCents !== undefined) {
    // The rounding remainder goes into permit, as it always has. A cent of drift on a
    // permit fee is invisible; a cent of drift on the number someone agreed to pay is the
    // bug this whole module exists to prevent.
    //
    // Clamped at zero, and not defensively — it is reachable. Just above the degenerate
    // threshold the construction fee can be a single cent, which makes permit
    // `round(0.0225) = 0`; a negative remainder there would print a permit fee of −$0.01.
    // A 126,000-case sweep never produced one, but "never observed" is not "cannot
    // happen", and the shortfall has somewhere better to go: construction is the largest
    // line by orders of magnitude and absorbs a cent invisibly.
    const delta = overrideTotalCents - total;
    if (permit + delta >= 0) {
      permit += delta;
    } else {
      constructionCents += permit + delta;
      permit = 0;
      // material/labour are a view OF construction, so they have to be re-derived — not
      // left describing the figure construction used to be.
      const reparts = allocate(constructionCents, { material: MATERIAL_PCT, labor: LABOR_PCT });
      parts.material = reparts.material;
      parts.labor    = reparts.labor;
    }
    total = overrideTotalCents;
  }

  return {
    total:        total              / 100,
    construction: constructionCents  / 100,
    material:     parts.material     / 100,
    labor:        parts.labor        / 100,
    permit:       permit             / 100,
    professional: professional       / 100,
    design:       flat.design        / 100,
    verification: flat.verification  / 100,
    contingency:  contingency        / 100,
  };
}

/** What the two composition functions need to know about a project's size. */
export interface BudgetShape {
  /** Total built area in m²: ground-floor footprint × number of floors. */
  builtAreaSqm: number;
  /**
   * Storeys including the ground floor.
   *
   * Required, not optional, and deliberately so: two professional fees are billed per
   * month and the duration comes from this. A caller that forgot it would silently quote
   * a bungalow's site manager for an eight-storey block, so the compiler is made to find
   * every call site instead.
   */
  floors: number;
}

/**
 * Forward direction: a construction fee in, the client's four-line budget out.
 *
 * Used wherever the budget is being *estimated* — the wizard, the public tool, and any
 * project whose owner has not yet confirmed a figure.
 */
export function composeBudget(constructionUSD: number, shape: BudgetShape): BudgetBreakdown {
  const construction = toCents(constructionUSD);

  // No build, no fees. The flat lines do not depend on the construction fee, so without
  // this the wizard would quote $583 of professional fee against an empty form before
  // anyone has entered a size.
  if (construction <= 0) {
    return {
      total: 0, construction: 0, material: 0, labor: 0,
      permit: 0, professional: 0, design: 0, verification: 0, contingency: 0,
    };
  }
  return assemble(construction, shape);
}

/**
 * Inverse direction: a confirmed total in, the same lines back out.
 *
 * This is what makes the model storable in one column. Every fee is either flat in the
 * construction fee or a fixed percentage of it, so the whole thing inverts in one step:
 *
 *     F        = design + siteManager + quantitySurveyor + contractLawyer + verification
 *     subtotal = C × (1 + permit% + projectManager%) + F
 *     total    = subtotal × (1 + contingency%)
 *
 *     ⟹  C = (total / 1.02 − F) / 1.0725
 *
 * recovers every line from `budget_usd` plus `sqm` and `num_floors`, both already on the
 * project row. No second source of truth for money, and nothing to keep in sync.
 *
 * This is the reason the project manager is a percentage and the site manager is not: had
 * both been monthly, the inversion would still work, but had either depended on something
 * absent from `ProjectRow` the single-column model would have had to go.
 *
 * Degenerate case: a total at or below the flat fees cannot satisfy both the fee formulas
 * and the total. The total wins — it is the number someone agreed to — so the fees are
 * scaled down to fit it and construction reads $0. That keeps the sum identity true for
 * every input rather than only for sensible ones.
 */
export function decomposeBudget(totalUSD: number, shape: BudgetShape): BudgetBreakdown {
  const totalCents = toCents(totalUSD);
  const flat       = flatFeeCents(shape.builtAreaSqm, shape.floors);
  const flatTotal  = flat.design + flat.siteManager + flat.quantitySurveyor
                   + flat.contractLawyer + flat.verification;

  // Strip the contingency first: it is the only line computed on the subtotal.
  const subtotalCents = Math.round(totalCents * 100 / (100 + CONTINGENCY_PCT));

  if (subtotalCents <= flatTotal) {
    const scaled = allocate(totalCents, {
      design:           flat.design,
      siteManager:      flat.siteManager,
      quantitySurveyor: flat.quantitySurveyor,
      contractLawyer:   flat.contractLawyer,
      verification:     flat.verification,
    });
    return {
      total:        totalCents / 100,
      construction: 0, material: 0, labor: 0, permit: 0, contingency: 0,
      professional: (scaled.siteManager + scaled.quantitySurveyor + scaled.contractLawyer) / 100,
      design:       scaled.design       / 100,
      verification: scaled.verification  / 100,
    };
  }

  const construction = Math.round(
    (subtotalCents - flatTotal) * 100
      / (100 + PERMIT_PCT_OF_BUILD + PROJECT_MANAGER_PCT_OF_BUILD),
  );
  return assemble(construction, shape, totalCents);
}

/** Built area from a wizard payload. `sqm` is the FOOTPRINT — see geometry.ts. */
function builtArea(sqm: number | undefined | null, floors: number | undefined | null): number {
  return Math.max(0, Number(sqm) || 0) * Math.max(1, Number(floors) || 1);
}

/**
 * The shape both composition functions need, from a footprint and a floor count.
 *
 * One helper rather than an object literal at each call site: `floors` is now load-bearing
 * for two monthly fees, and a caller that built half a shape would quote a bungalow's site
 * manager for a tower block.
 */
function shapeOf(sqm: number | undefined | null, floors: number | undefined | null): BudgetShape {
  return {
    builtAreaSqm: builtArea(sqm, floors),
    floors:       Math.max(1, Number(floors) || 1),
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
  const shape = shapeOf(project.sqm, project.num_floors);

  // The confirmed total is authoritative. `decomposeBudget` recovers the four lines from
  // it rather than re-pricing, so an owner who edited their budget sees components that
  // sum to THEIR number, not to the estimate.
  if (project.budget_usd != null) return decomposeBudget(project.budget_usd, shape);

  const data: Partial<WizardFormData> = {
    country:         project.country,
    city:            project.city ?? undefined,
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  };
  return composeBudget(calculateTotal(data, rate ?? buildLegacyRate(data), cityRate), shape);
}

/** The fields of a `ProjectRow` that pricing actually reads. */
export type ProjectBudgetSource = Pick<ProjectRow,
  | 'country' | 'city' | 'num_floors' | 'building_type' | 'roof_type'
  | 'has_boys_quarters' | 'bq_rooms' | 'sqm' | 'finish_level' | 'budget_usd'>;

/**
 * Display order, labels and colours for the four lines a client is quoted.
 *
 * The percentage column is deliberately absent. Three of these four lines are not a
 * percentage of the total — professional is flat, design is per m², and permit is a
 * percentage of *construction* — so printing one figure as "X% of the total" is exactly
 * the class of statement that made the previous split untrustworthy. Components that want
 * a share compute it from the amounts, against one denominator.
 */
export const BUDGET_SLICES = [
  { key: 'construction', labelKey: 'project.costing.sliceConstruction', color: '#1f2937' },
  { key: 'design',       labelKey: 'project.costing.sliceDesign',       color: '#374151' },
  { key: 'professional', labelKey: 'project.costing.sliceProfessional', color: '#4b5563' },
  { key: 'verification', labelKey: 'project.costing.sliceVerification', color: '#6b7280' },
  { key: 'permit',       labelKey: 'project.costing.slicePermit',       color: '#9ca3af' },
  { key: 'contingency',  labelKey: 'project.costing.sliceContingency',  color: '#d1d5db' },
] as const satisfies readonly {
  key: Exclude<keyof BudgetBreakdown, 'total' | 'material' | 'labor'>;
  labelKey: TKey;
  color: string;
}[];

/**
 * Each slice's share of the total, in tenths of a percent, summing to exactly 100.0.
 *
 * Derived from the amounts rather than declared, because only one of the four lines is a
 * fixed percentage of anything. Allocated for the same reason `finalizeSections` allocates:
 * four independent `Math.round` calls print a column that does not add to 100.
 */
export function sliceShares(b: BudgetBreakdown): Record<BudgetSliceKey, number> {
  const tenths = allocate(1000, {
    construction: Math.max(0, b.construction),
    design:       Math.max(0, b.design),
    professional: Math.max(0, b.professional),
    verification: Math.max(0, b.verification),
    permit:       Math.max(0, b.permit),
    contingency:  Math.max(0, b.contingency),
  });
  return {
    construction: tenths.construction / 10,
    design:       tenths.design       / 10,
    professional: tenths.professional / 10,
    verification: tenths.verification / 10,
    permit:       tenths.permit       / 10,
    contingency:  tenths.contingency  / 10,
  };
}

export type BudgetSliceKey = (typeof BUDGET_SLICES)[number]['key'];

/**
 * The material/labour view of the construction fee.
 *
 * Kept apart from BUDGET_SLICES because these two are a *breakdown of* the construction
 * line, not additional lines. Rendering all six together would double-count the build.
 */
export const CONSTRUCTION_SPLIT = [
  { key: 'material', labelKey: 'project.costing.sliceMaterial', pct: MATERIAL_PCT },
  { key: 'labor',    labelKey: 'project.costing.sliceLabor',    pct: LABOR_PCT    },
] as const satisfies readonly {
  key: Extract<keyof BudgetBreakdown, 'material' | 'labor'>;
  labelKey: TKey;
  pct: number;
}[];

/**
 * The CONSTRUCTION fee in USD — the build itself, with no permit, professional or design
 * fee in it. `composeBudget` is what turns this into the figure a client sees.
 */
function calculateTotal(
  data: Partial<WizardFormData>,
  effective: ConstructionRate,
  cityRate?: CityRate | null,
): number {
  const takeoff = runTakeoff(data, effective, cityRate);
  if (takeoff) return Math.round(takeoff.totalLocal / effective.approx_fx_rate);
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

  if (takeoff) {
    const total = Math.round(takeoff.totalLocal / fx);
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
    finalizeSections(sections, total, fx);
    return {
      sections, total,
      totalLocal:   Math.round(total * fx),
      currencyCode: effective.currency_code,
      approxFxRate: fx,
      dataSource:   effective.data_source,
      budget:       composeBudget(total, shapeOf(data.sqm, data.floors)),
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
  finalizeSections(sections, total, fx);

  return {
    sections, total,
    totalLocal:   Math.round(total * fx),
    currencyCode: effective.currency_code,
    approxFxRate: fx,
    dataSource:   effective.data_source,
    budget:       composeBudget(total, shapeOf(data.sqm, data.floors)),
  };
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
