import { useCallback } from 'react';
import { useT, type TKey } from '@/lib/i18n';

/**
 * Translated labels for the domain enums — project type, building type, roof, finish
 * level, tier, document category, and the wizard preview captions.
 *
 * These used to be `_LABELS` object literals copy-pasted across twelve components. That
 * was not only untranslatable, it had drifted: `BT_LABELS` existed in four files with
 * 14, 16, 16 and 21 entries, so the dashboard rendered an empty cell for the eight
 * building types it had never been updated with. `mixed_residential_commercial` was
 * "Residential + Commercial" in two files and "Res + Commercial" in another.
 *
 * Every lookup falls back to the raw enum value rather than rendering blank, so an
 * unknown value degrades to something a support conversation can work with.
 */
export function useDomainLabels() {
  const t = useT();

  const lookup = useCallback(
    (group: string, value: string | null | undefined): string => {
      if (!value) return '—';
      const key = `${group}.${value}` as TKey;
      const hit = t(key);
      // t() returns the key when it is missing; show the raw value instead.
      return hit === key ? value : hit;
    },
    [t],
  );

  return {
    projectType:  (v: string | null | undefined) => lookup('projectType', v),
    buildingType: (v: string | null | undefined) => lookup('buildingType', v),
    roofType:     (v: string | null | undefined) => lookup('roofType', v),
    finishLevel:  (v: string | null | undefined) => lookup('finishLevel', v),
    tier:         (v: string | null | undefined) => lookup('tier', v),
    docCategory:  (v: string | null | undefined) => lookup('docCategory', v),
    /**
     * Country name for an ISO code. `countries.ts` keeps the English name as its
     * `name` field because the PDF export and the budget engine read it outside
     * React; this is the display path.
     */
    country:      (v: string | null | undefined) => lookup('country', v),
    /** Preview panel caption for a wizard image key. */
    previewTitle: (v: string | null | undefined) => lookup('preview.title', v),
  };
}
