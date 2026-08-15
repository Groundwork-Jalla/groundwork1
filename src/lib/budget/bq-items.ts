import type { SectionKey } from './engine';
import type { LineKind } from './lines';
import type { TKey } from '@/lib/i18n/translate';

// =========================================================
// BQ item catalogue — METADATA ONLY.
//
// What each item number means, what unit it is measured in, and whether the rate behind
// it came out of a real Bill of Quantity. No arithmetic: every rate and coefficient stays
// in engine.ts and model.ts, so there is exactly one place a number can be wrong.
//
// The numbering follows the four Cameroonian BQs in docs/ — 100 preliminaries,
// 200 substructure, 300 superstructure, 500 roof, 600 joinery, 700 electrical,
// 800 plumbing, 900 finishes. Codes are stable: contractor overrides are keyed on them,
// so renumbering an item orphans every override that referenced it.
//
// `provisional: true` means the RATE is not confirmed against docs/*.xlsx. Those render
// with a softer badge. Shipping a guess that looks like a measurement is worse than
// omitting the line — a contractor who catches one invented figure stops trusting the
// document, which is exactly the credibility problem this whole workstream exists to fix.
// =========================================================

export interface BqItem {
  section: SectionKey;
  labelKey: TKey;
  unit: string;
  kind: LineKind;
  /** Rate not confirmed against a source BQ. */
  provisional?: boolean;
}

export const BQ_ITEMS = {
  // ── 100 Preliminaries ──
  '101': { section: 'preliminary',  labelKey: 'bq.101', unit: 'item', kind: 'item',     provisional: true },
  '102': { section: 'preliminary',  labelKey: 'bq.102', unit: 'm²',   kind: 'measured', provisional: true },

  // ── 200 Substructure ──
  '201': { section: 'foundation',   labelKey: 'bq.201', unit: 'm³',   kind: 'measured' },
  '202': { section: 'foundation',   labelKey: 'bq.202', unit: 'm³',   kind: 'measured' },
  '203': { section: 'foundation',   labelKey: 'bq.203', unit: 'm³',   kind: 'measured' },
  '204': { section: 'foundation',   labelKey: 'bq.204', unit: 'm³',   kind: 'measured' },
  '205': { section: 'foundation',   labelKey: 'bq.205', unit: 'm³',   kind: 'measured' },
  '206': { section: 'foundation',   labelKey: 'bq.206', unit: 'm²',   kind: 'measured' },
  '207': { section: 'foundation',   labelKey: 'bq.207', unit: 'm²',   kind: 'measured', provisional: true },
  '208': { section: 'foundation',   labelKey: 'bq.208', unit: 'm²',   kind: 'measured', provisional: true },

  // ── 300 Superstructure, ground floor ──
  '301': { section: 'ground_floor', labelKey: 'bq.301', unit: 'm³',   kind: 'measured' },
  '302': { section: 'ground_floor', labelKey: 'bq.302', unit: 'm³',   kind: 'measured' },
  '303': { section: 'ground_floor', labelKey: 'bq.303', unit: 'm³',   kind: 'measured' },
  '305': { section: 'ground_floor', labelKey: 'bq.305', unit: 'm²',   kind: 'measured' },
  '306': { section: 'ground_floor', labelKey: 'bq.306', unit: 'm²',   kind: 'measured' },
  '307': { section: 'ground_floor', labelKey: 'bq.307', unit: 'm²',   kind: 'measured' },
  '308': { section: 'ground_floor', labelKey: 'bq.308', unit: 'm³',   kind: 'measured' },
  '309': { section: 'ground_floor', labelKey: 'bq.309', unit: 'm²',   kind: 'measured' },
  '310': { section: 'ground_floor', labelKey: 'bq.310', unit: 'm²',   kind: 'measured' },
  '311': { section: 'ground_floor', labelKey: 'bq.311', unit: 'm²',   kind: 'measured' },

  // ── 400 Superstructure, upper floors ──
  // Same trades as 300. Quantities carry the floor count rather than the section total
  // being multiplied, which is how a contractor expects to read it: 3 floors of blockwork
  // is a bigger quantity at the same rate, not a scaled-up subtotal.
  '401': { section: 'upper_floor',  labelKey: 'bq.301', unit: 'm³',   kind: 'measured' },
  '402': { section: 'upper_floor',  labelKey: 'bq.302', unit: 'm³',   kind: 'measured' },
  '405': { section: 'upper_floor',  labelKey: 'bq.305', unit: 'm²',   kind: 'measured' },
  '406': { section: 'upper_floor',  labelKey: 'bq.306', unit: 'm²',   kind: 'measured' },
  '409': { section: 'upper_floor',  labelKey: 'bq.309', unit: 'm²',   kind: 'measured' },
  '410': { section: 'upper_floor',  labelKey: 'bq.310', unit: 'm²',   kind: 'measured' },
  '411': { section: 'upper_floor',  labelKey: 'bq.311', unit: 'm²',   kind: 'measured' },

  // ── 500 Roof ──
  '501': { section: 'roof',         labelKey: 'bq.501', unit: 'ml',   kind: 'measured', provisional: true },
  '502': { section: 'roof',         labelKey: 'bq.502', unit: 'm²',   kind: 'measured', provisional: true },
  '503': { section: 'roof',         labelKey: 'bq.503', unit: 'm²',   kind: 'measured' },
  '504': { section: 'roof',         labelKey: 'bq.504', unit: 'item', kind: 'item'     },

  // ── 600 Joinery ──
  '601': { section: 'joinery',      labelKey: 'bq.601', unit: 'nr',   kind: 'measured' },
  '605': { section: 'joinery',      labelKey: 'bq.605', unit: 'nr',   kind: 'measured' },
  '606': { section: 'joinery',      labelKey: 'bq.606', unit: 'ml',   kind: 'measured' },

  // ── 700 Electrical ──
  // Electrical is byte-identical at 2,326,600 across three documents with 12, 9 and 9
  // rooms, so in the source data it tracks floors rather than rooms. Whether it is a
  // quoted package or a measured install is Q9 in docs/BQ-QUESTIONS.md — until Vanessa
  // answers, both lines are provisional.
  '701': { section: 'electrical',   labelKey: 'bq.701', unit: 'floor', kind: 'measured', provisional: true },
  '702': { section: 'electrical',   labelKey: 'bq.702', unit: 'nr',    kind: 'measured', provisional: true },

  // ── 800 Plumbing and sanitary ──
  '801': { section: 'plumbing',     labelKey: 'bq.801', unit: 'item', kind: 'item'     },
  '802': { section: 'plumbing',     labelKey: 'bq.802', unit: 'item', kind: 'item'     },
  '803': { section: 'plumbing',     labelKey: 'bq.803', unit: 'item', kind: 'item'     },
  '804': { section: 'plumbing',     labelKey: 'bq.804', unit: 'item', kind: 'item'     },
  '805': { section: 'plumbing',     labelKey: 'bq.805', unit: 'nr',   kind: 'measured' },
  '806': { section: 'plumbing',     labelKey: 'bq.806', unit: 'nr',   kind: 'measured' },
  '807': { section: 'plumbing',     labelKey: 'bq.807', unit: 'nr',   kind: 'measured' },
  '808': { section: 'plumbing',     labelKey: 'bq.808', unit: 'nr',   kind: 'measured' },
  '809': { section: 'plumbing',     labelKey: 'bq.809', unit: 'nr',   kind: 'measured' },
  '810': { section: 'plumbing',     labelKey: 'bq.810', unit: 'nr',   kind: 'measured' },

  // ── 900 Finishes ──
  '901': { section: 'finishing',    labelKey: 'bq.901', unit: 'm²',   kind: 'measured' },
  '907': { section: 'finishing',    labelKey: 'bq.907', unit: 'item', kind: 'item',     provisional: true },
  '999': { section: 'finishing',    labelKey: 'bq.999', unit: '%',    kind: 'percentage' },
} as const satisfies Record<string, BqItem>;

export type BqCode = keyof typeof BQ_ITEMS;

export function bqItem(code: string): BqItem | undefined {
  return (BQ_ITEMS as Record<string, BqItem>)[code];
}
