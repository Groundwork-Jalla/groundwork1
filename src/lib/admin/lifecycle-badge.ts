import type { TKey } from '@/lib/i18n';
import type { StageBlocker, StageLifecycle, StageLifecycleState } from '@/lib/lifecycle/stage';

// =========================================================
// What the StageLifecycleBadge shows for a derived lifecycle (05 §7).
//
// RENDERS THE RESULT, NEVER RECOMPUTES IT (Favour, 17 Sep 2026). The input is the
// `StageLifecycle` that `stageLifecycle()` already produced — `{ state, blockers }` — and
// the output is which word, which accent, which blocker. Nothing here looks at a stage
// row, a verification or the ledger; if the badge and the Action Center ever disagree
// about a stage, the bug is upstream and there is exactly one place to look.
//
// Colour is a status ACCENT — a 6px dot and the word's own colour — never a tinted
// tile. That is the Foundations rule `StatusBadge` follows, and a stage ladder of ten
// badges should read as a ledger, not a paint chart.
// =========================================================

export type Accent = 'grey' | 'neutral' | 'amber' | 'green' | 'red';

export interface LifecycleMeta {
  labelKey: TKey;
  accent: Accent;
  /** `payment_eligible` only: the one state the desk is waiting to act on, set in bold. */
  emphasis?: boolean;
}

/** Accent → the dot and text classes. The tokens flip with the theme in globals.css. */
export const ACCENT_CLASS: Record<Accent, { dot: string; text: string }> = {
  grey:    { dot: 'bg-state-locked',   text: 'text-ink-35' },
  neutral: { dot: 'bg-state-active',   text: 'text-state-active' },
  amber:   { dot: 'bg-state-held',     text: 'text-state-held' },
  green:   { dot: 'bg-state-complete', text: 'text-state-complete' },
  red:     { dot: 'bg-state-alert',    text: 'text-state-alert' },
};

/** The table in 05 §7, one row per derived state. */
export const LIFECYCLE_META: Record<StageLifecycleState, LifecycleMeta> = {
  locked:                   { labelKey: 'admin.lifecycle.state.locked',                   accent: 'grey' },
  in_progress:              { labelKey: 'admin.lifecycle.state.in_progress',              accent: 'neutral' },
  evidence_submitted:       { labelKey: 'admin.lifecycle.state.evidence_submitted',       accent: 'neutral' },
  verification_pending:     { labelKey: 'admin.lifecycle.state.verification_pending',     accent: 'amber' },
  verification_in_progress: { labelKey: 'admin.lifecycle.state.verification_in_progress', accent: 'amber' },
  rejected:                 { labelKey: 'admin.lifecycle.state.rejected',                 accent: 'red' },
  verified:                 { labelKey: 'admin.lifecycle.state.verified',                 accent: 'green' },
  approved:                 { labelKey: 'admin.lifecycle.state.approved',                 accent: 'green' },
  payment_eligible:         { labelKey: 'admin.lifecycle.state.payment_eligible',         accent: 'green', emphasis: true },
  release_authorised:       { labelKey: 'admin.lifecycle.state.release_authorised',       accent: 'green' },
  disbursement_initiated:   { labelKey: 'admin.lifecycle.state.disbursement_initiated',   accent: 'green' },
  disbursed:                { labelKey: 'admin.lifecycle.state.disbursed',                accent: 'green' },
  payment_failed:           { labelKey: 'admin.lifecycle.state.payment_failed',           accent: 'red' },
  completed:                { labelKey: 'admin.lifecycle.state.completed',                accent: 'green' },
};

/**
 * A state this build does not know. The type is closed, so this is reached only when
 * the lifecycle module gains a state before this table does — and then the badge says
 * so in grey rather than crashing the tab or guessing a colour.
 */
export const UNKNOWN_META: LifecycleMeta = { labelKey: 'admin.lifecycle.state.unknown', accent: 'grey' };

export const BLOCKER_LABEL: Record<StageBlocker, TKey> = {
  verifier_not_selected: 'admin.lifecycle.blocker.verifier_not_selected',
  awaiting_funding:      'admin.lifecycle.blocker.awaiting_funding',
  on_hold:               'admin.lifecycle.blocker.on_hold',
};

/**
 * The blocker the badge names beside the state: the first one that is not `on_hold`.
 * `on_hold` is reported on every stage of a held project (it is the project's state, not
 * the stage's), so it is shown as an overlay on the whole badge, not as this stage's reason.
 */
export function primaryBlocker(lifecycle: Pick<StageLifecycle, 'blockers'>): Exclude<StageBlocker, 'on_hold'> | null {
  return (lifecycle.blockers.find(b => b !== 'on_hold') as Exclude<StageBlocker, 'on_hold'> | undefined) ?? null;
}

export interface BadgeModel {
  state: StageLifecycleState;
  known: boolean;
  labelKey: TKey;
  accent: Accent;
  dot: string;
  text: string;
  emphasis: boolean;
  /** Label key of the blocker to name, or null when there is none to name. */
  blockerKey: TKey | null;
  /** The project is on hold — rendered as an overlay on every state. */
  onHold: boolean;
}

/** Everything the component renders, decided once here so a test can read it without a DOM. */
export function badgeModel(lifecycle: StageLifecycle): BadgeModel {
  const meta = (LIFECYCLE_META as Partial<Record<string, LifecycleMeta>>)[lifecycle.state];
  const known = meta !== undefined;
  const m = meta ?? UNKNOWN_META;
  const blocker = primaryBlocker(lifecycle);
  return {
    state: lifecycle.state,
    known,
    labelKey: m.labelKey,
    accent: m.accent,
    dot: ACCENT_CLASS[m.accent].dot,
    text: ACCENT_CLASS[m.accent].text,
    emphasis: m.emphasis === true,
    blockerKey: blocker ? BLOCKER_LABEL[blocker] : null,
    onHold: lifecycle.blockers.includes('on_hold'),
  };
}
