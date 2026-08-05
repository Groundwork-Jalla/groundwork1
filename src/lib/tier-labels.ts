import { useMemo } from 'react';
import { useT, type TKey } from '@/lib/i18n';
import { TIER_ECONOMICS, type TierEconomics } from '@/lib/payments/config';
import type { ProjectTier } from '@/types/project';

/**
 * Translated plan cards.
 *
 * `TIER_ECONOMICS` in payments/config.ts stays the single source of truth for the
 * money — `feePct`, `priceValue`. This hook overlays the display strings from the
 * dictionary, so the upgrade screen and the profile plan cards read from one place
 * and both translate.
 *
 * `price` is a display string rather than a formatted number because the tiers are not
 * all money: "Free" and "Custom" have no amount, and `priceValue` is null for the
 * negotiated tier.
 */
export interface TierDisplay extends TierEconomics {
  name: string;
  /** Short label for the segmented selector, where "Jalla Management" does not fit. */
  short: string;
  price: string;
  period?: string;
  tag?: string;
  feeLabel: string;
  desc: string;
  features: string[];
  cta: string;
}

/** Dictionary sub-key per tier. The DB values are snake_case; the keys are not. */
const DICT_KEY: Record<ProjectTier, string> = {
  self_verify:      'selfVerify',
  jalla_verify:     'jallaVerify',
  jalla_management: 'jallaManagement',
};

export function useTierBilling(): Record<ProjectTier, TierDisplay> {
  const t = useT();

  return useMemo(() => {
    const build = (id: ProjectTier): TierDisplay => {
      const econ = TIER_ECONOMICS[id];
      const k    = DICT_KEY[id];
      const key  = (leaf: string) => `tierBilling.${k}.${leaf}` as TKey;

      return {
        ...econ,
        name:     t(`tiers.${k}` as TKey),
        short:    t(key('short')),
        price:    t(key('price')),
        feeLabel: t(key('feeLabel')),
        desc:     t(key('desc')),
        cta:      t(key('cta')),
        // Only the tiers that declare these get them looked up — t() renders the key
        // itself when it is missing, which would put "tierBilling.selfVerify.period"
        // on screen next to the price.
        ...(econ.hasPeriod ? { period: t(key('period')) } : {}),
        ...(econ.hasTag    ? { tag:    t(key('tag'))    } : {}),
        features: Array.from({ length: econ.featureCount }, (_, i) => t(key(`f${i + 1}`))),
      };
    };

    return {
      self_verify:      build('self_verify'),
      jalla_verify:     build('jalla_verify'),
      jalla_management: build('jalla_management'),
    };
  }, [t]);
}
