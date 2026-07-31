import type { ProjectTier } from '@/types/project';

// =========================================================
// Payments config — PLACEHOLDER values.
// These fees / prices / caps are NOT final. They are centralized here so the
// real numbers can be dropped in one place once confirmed, and so the public
// pricing page (already approved) is never coupled to them.
// Real charging (Stripe hold) + payouts (pawaPay XAF) are not wired yet.
// =========================================================

export const PAYMENTS_ARE_PREVIEW = true;

export interface TierBilling {
  id: ProjectTier;
  name: string;
  price: string;          // display string
  priceValue: number | null;
  period?: string;
  /** Platform processing fee as a fraction of the stage amount. null = custom/negotiated. */
  feePct: number | null;
  feeLabel: string;       // e.g. "10% fee"
  desc: string;
  features: string[];
  tag?: string;
  cta: string;
}

export const TIER_BILLING: Record<ProjectTier, TierBilling> = {
  self_verify: {
    id: 'self_verify',
    name: 'Self Verify',
    price: 'Free',
    priceValue: 0,
    feePct: 0.10,
    feeLabel: '10% fee',
    desc: 'Full control. You review every stage yourself.',
    features: ['3 projects max', '1 contractor', 'Self-approve stages', '500MB storage', '10% payment fee'],
    cta: 'Start Free',
  },
  jalla_verify: {
    id: 'jalla_verify',
    name: 'Jalla Verify',
    price: '$199',
    priceValue: 199,
    period: '/mo',
    feePct: 0.03,
    feeLabel: '3% fee',
    desc: 'Independent verification by Jalla professionals on every stage.',
    tag: 'MOST POPULAR',
    features: ['Unlimited projects', 'Unlimited contractors', 'Jalla verifies stages', 'Stage certificates', '3% payment fee', 'Weekly reports', 'Community access'],
    cta: 'Subscribe — $199/mo',
  },
  jalla_management: {
    id: 'jalla_management',
    name: 'Jalla Management',
    price: 'Custom',
    priceValue: null,
    feePct: null,
    feeLabel: 'Custom terms',
    desc: 'Full-service. Jalla manages your entire project from start to finish.',
    features: ['Dedicated PM', 'On-site team', 'Daily updates', 'Procurement oversight', 'Custom reporting'],
    cta: 'Contact Sales',
  },
};

/** Rough Stripe processing estimate (~2.9%). Placeholder — display only. */
export const STRIPE_PROCESSING_PCT = 0.029;

/** Fallback FX when a project's construction rate can't be loaded. */
export const FALLBACK_FX = { currency_code: 'XAF', approx_fx_rate: 600 };

/** Platform fee for a stage amount, by tier. Returns 0 for custom tiers. */
export function platformFee(amountUsd: number, tier: ProjectTier): number {
  const pct = TIER_BILLING[tier]?.feePct ?? 0;
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
