import type { PaymentStatus, StageStatus, SubstageStatus } from '@/types/project';
import type { TKey } from '@/lib/i18n';

/**
 * The Foundations status vocabulary.
 *
 * Six vocabularies used to coexist in this codebase — "Spent", "Paid", "Done", "Active",
 * "Deposited", "In escrow", "Remaining", "Transit" — often two of them on the same
 * screen for the same underlying value. Foundations collapses that to the six states
 * below, and nothing else may be rendered as a status.
 *
 * The DB columns keep their own values (StageStatus, PaymentStatus, SubstageStatus).
 * This module is the single translation layer between what is stored and what is shown.
 */

export const STATES = [
  'complete',
  'in_progress',
  'in_transit',
  'held',
  'locked',
  'needs_attention',
] as const;

export type State = (typeof STATES)[number];

export interface StateMeta {
  /** i18n key for the badge word. */
  labelKey: TKey;
  /** Tailwind class for the 6px dot and any figure taking the state's colour. */
  dot: string;
  /** Text colour for the badge word and the figure itself. */
  text: string;
}

/**
 * No tinted backgrounds. Foundations: "state is carried by a 6px dot and the figure's
 * own colour, not by a pastel pill" — a table of ten stages should read as a ledger,
 * not a paint chart.
 */
export const STATE_META: Record<State, StateMeta> = {
  complete:        { labelKey: 'status.complete'       as TKey, dot: 'bg-state-complete', text: 'text-state-complete' },
  in_progress:     { labelKey: 'status.inProgress'     as TKey, dot: 'bg-state-active',   text: 'text-state-active'   },
  in_transit:      { labelKey: 'status.inTransit'      as TKey, dot: 'bg-state-active',   text: 'text-state-active'   },
  held:            { labelKey: 'status.held'           as TKey, dot: 'bg-state-held',     text: 'text-state-held'     },
  locked:          { labelKey: 'status.locked'         as TKey, dot: 'bg-state-locked',   text: 'text-ink-35'         },
  needs_attention: { labelKey: 'status.needsAttention' as TKey, dot: 'bg-state-alert',    text: 'text-state-alert'    },
};

/**
 * Money buckets. Foundations names four, and they are not the same list as the states:
 * a bucket describes where money sits, a state describes where work sits.
 *
 * "Spent" → released. "Deposited" / "In escrow" → held. "Remaining" → locked.
 */
export const MONEY_BUCKETS = ['released', 'in_transit', 'held', 'locked'] as const;
export type MoneyBucket = (typeof MONEY_BUCKETS)[number];

export const MONEY_BUCKET_META: Record<MoneyBucket, StateMeta> = {
  released:   { labelKey: 'status.money.released'  as TKey, dot: 'bg-state-complete', text: 'text-state-complete' },
  in_transit: { labelKey: 'status.money.inTransit' as TKey, dot: 'bg-state-active',   text: 'text-state-active'   },
  held:       { labelKey: 'status.money.held'      as TKey, dot: 'bg-state-held',     text: 'text-state-held'     },
  locked:     { labelKey: 'status.money.locked'    as TKey, dot: 'bg-state-locked',   text: 'text-ink-35'         },
};

// ── Mapping stored values onto the vocabulary ──────────────

export function stageState(status: StageStatus): State {
  switch (status) {
    case 'complete':       return 'complete';
    case 'active':         return 'in_progress';
    case 'pending_review': return 'held';       // work submitted, awaiting verification
    case 'locked':         return 'locked';
  }
}

export function substageState(status: SubstageStatus): State {
  switch (status) {
    case 'complete':       return 'complete';
    case 'in_progress':    return 'in_progress';
    case 'pending_review': return 'held';
    case 'pending':        return 'in_progress';
    case 'locked':         return 'locked';
  }
}

/**
 * Payment status onto the state vocabulary.
 *
 * 'partial' maps to in_transit rather than getting a word of its own — Foundations
 * allows six states and no others, and a part-released milestone is money moving.
 */
export function paymentState(status: PaymentStatus): State {
  switch (status) {
    case 'paid':    return 'complete';
    case 'partial': return 'in_transit';
    case 'unpaid':  return 'locked';
  }
}

/** Money bucket for a stage's milestone amount. */
export function milestoneBucket(
  stageStatus: StageStatus,
  paymentStatus: PaymentStatus,
): MoneyBucket {
  if (paymentStatus === 'paid')    return 'released';
  if (paymentStatus === 'partial') return 'in_transit';
  if (stageStatus === 'pending_review') return 'held';
  return 'locked';
}
