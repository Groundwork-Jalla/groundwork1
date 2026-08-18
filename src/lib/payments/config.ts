import type { ProjectTier } from '@/types/project';

// =========================================================
// Payments config — PLACEHOLDER values.
// These fees / prices / caps are NOT final. They are centralized here so the
// real numbers can be dropped in one place once confirmed, and so the public
// pricing page (already approved) is never coupled to them.
// Real charging (Stripe hold) + payouts (Switchr XAF) are not wired yet.
// =========================================================

/**
 * Two rails, two states — they are not both preview any more.
 *
 *   Stripe   Jalla Verify subscription, client → Jalla.   LIVE (see api/stripe/)
 *   Switchr  project funds + contractor payouts in XAF.   NOT WIRED
 *
 * Contractors are never paid through Stripe: Stripe Connect does not support payouts to
 * Cameroon, and no milestone money passes through a Stripe balance.
 */

/** Milestone charging and contractor payouts still await the Switchr integration. */
export const MILESTONE_PAYMENTS_ARE_PREVIEW = true;

/** Subscriptions run on Stripe Checkout. Keep true only if the keys are not yet set. */
export const SUBSCRIPTIONS_ARE_PREVIEW = false;

/** @deprecated Ambiguous now the two rails differ. Use the specific flag. */
export const PAYMENTS_ARE_PREVIEW = MILESTONE_PAYMENTS_ARE_PREVIEW;

/**
 * Plan economics. Numbers only — every user-facing string for a tier (name, price
 * label, description, feature bullets, CTA) lives in the dictionary and is read via
 * `useTierBilling()` in src/lib/tier-labels.ts.
 *
 * They used to live together. That meant the same plan name existed here, in
 * `UpgradeScreen`'s SHORT map, in `tiers.*` and in profile.tsx — four copies that had
 * already drifted. One home for the money, one home for the words.
 */
export interface TierEconomics {
  id: ProjectTier;
  /** Monthly subscription in USD. null = negotiated, 0 = free. */
  priceValue: number | null;
  /** Platform processing fee as a fraction of the stage amount. null = custom/negotiated. */
  feePct: number | null;
  /** This tier shows a "/mo" suffix — drives the optional `tierBilling.*.period` lookup. */
  hasPeriod: boolean;
  /** This tier shows a highlight badge — drives the optional `tierBilling.*.tag` lookup. */
  hasTag: boolean;
  /** How many `tierBilling.*.fN` feature bullets the dictionary carries. */
  featureCount: number;
}

export const TIER_ECONOMICS: Record<ProjectTier, TierEconomics> = {
  self_verify: {
    id: 'self_verify',
    priceValue: 0,
    feePct: 0.10,
    hasPeriod: false,
    hasTag: false,
    featureCount: 5,
  },
  jalla_verify: {
    id: 'jalla_verify',
    priceValue: 199,
    feePct: 0.03,
    hasPeriod: true,
    hasTag: true,
    // 6 since "Community access" went: the community is gone, and a paid tier must not
    // list a benefit that no longer exists. data-keys.test.ts pins this to the number
    // of fN keys in the dictionary.
    featureCount: 6,
  },
  jalla_management: {
    id: 'jalla_management',
    priceValue: null,
    feePct: null,
    hasPeriod: false,
    hasTag: false,
    featureCount: 5,
  },
};

/** Rough Stripe processing estimate (~2.9%). Placeholder — display only. */
export const STRIPE_PROCESSING_PCT = 0.029;

/** Fallback FX when a project's construction rate can't be loaded. */
export const FALLBACK_FX = { currency_code: 'XAF', approx_fx_rate: 600 };

/** Platform fee for a stage amount, by tier. Returns 0 for custom tiers. */
export function platformFee(amountUsd: number, tier: ProjectTier): number {
  const pct = TIER_ECONOMICS[tier]?.feePct ?? 0;
  return Math.round(amountUsd * pct * 100) / 100;
}

/** Estimated Stripe processing cost for a charge. Display only. */
export function stripeProcessing(amountUsd: number): number {
  return Math.round(amountUsd * STRIPE_PROCESSING_PCT * 100) / 100;
}

/** Normalize any legacy tier string to the canonical ProjectTier. */
export function normalizeTier(tier: string): ProjectTier {
  if (tier === 'starter') return 'self_verify';
  if (tier === 'pro') return 'jalla_verify';
  if (tier === 'enterprise') return 'jalla_management';
  return (tier as ProjectTier) ?? 'self_verify';
}
