import {
  CHARGED_STAGE_COUNT, DESIGN_RATE_XAF_PER_M2, LABOR_PCT,
  MATERIAL_PCT, PERMIT_PCT_OF_BUILD, PROFESSIONAL_FEE_XAF,
} from './index';
import type { BudgetSliceKey } from './index';
import type { BudgetBreakdown } from '@/types/project';
import type { TKey } from '@/lib/i18n/translate';

// =========================================================
// How each of the four budget lines is arrived at.
//
// One definition, because it was previously written out only inside the
// "How is this calculated?" modal on the overview tab — in hardcoded English, which
// meant the derivation did not exist in French at all and did not exist on the costing
// tab in any language. Favour's note: the costing section "only has a drop down for the
// construction. It doesn't have a drop down for design... professional fees or permits."
//
// Deliberately returns DATA, not strings. The caller translates, because a component
// has a `t` and this module must stay importable from the PDF exporter and the
// serverless email path, neither of which has React context.
// =========================================================

/** One line of a derivation: a translated label, its inputs, and what it comes to. */
export interface DerivationRow {
  labelKey: TKey;
  /** Interpolation values for `labelKey`, already formatted for display. */
  params?: Record<string, string | number>;
  /** USD. Null for a row that only explains rather than totalling to something. */
  amount: number | null;
}

export interface SliceDerivation {
  rows: DerivationRow[];
  /** One-line caveat under the rows — when it is paid, or what it is charged on. */
  noteKey?: TKey;
}

/**
 * The derivation for one slice.
 *
 * `builtAreaSqm` is footprint × floors, the same figure the design fee is charged on.
 */
export function sliceDerivation(
  key: BudgetSliceKey,
  b: BudgetBreakdown,
  builtAreaSqm: number,
): SliceDerivation | null {
  switch (key) {
    case 'construction':
      // The 60/40 is display-only — it splits the construction fee, it does not add to
      // it. Showing both parts and the whole is what stops it reading as three charges.
      return {
        rows: [
          { labelKey: 'project.costing.derive.material', params: { pct: MATERIAL_PCT }, amount: b.material },
          { labelKey: 'project.costing.derive.labor',    params: { pct: LABOR_PCT    }, amount: b.labor    },
        ],
        noteKey: 'project.costing.derive.constructionNote',
      };

    case 'design':
      return {
        rows: [{
          labelKey: 'project.costing.derive.design',
          params: {
            rate: DESIGN_RATE_XAF_PER_M2.toLocaleString('en-US'),
            sqm:  Math.round(builtAreaSqm).toLocaleString('en-US'),
          },
          amount: b.design,
        }],
        noteKey: 'project.costing.derive.designNote',
      };

    case 'professional':
      return {
        rows: [{
          labelKey: 'project.costing.derive.professional',
          params: {
            rate:   PROFESSIONAL_FEE_XAF.toLocaleString('en-US'),
            stages: CHARGED_STAGE_COUNT,
          },
          amount: b.professional,
        }],
        noteKey: 'project.costing.derive.professionalNote',
      };

    case 'permit':
      return {
        rows: [{
          labelKey: 'project.costing.derive.permit',
          params: { pct: PERMIT_PCT_OF_BUILD },
          amount: b.permit,
        }],
        noteKey: 'project.costing.derive.permitNote',
      };

    default:
      return null;
  }
}
