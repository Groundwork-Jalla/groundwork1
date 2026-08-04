import { useCallback } from 'react';
import { useT, type TKey } from '@/lib/i18n';
import type { ProjectStageRow, ProjectSubstageRow } from '@/types/project';

/**
 * Translated stage and substage names.
 *
 * Stage names are persisted English strings — `project_stages.name` is written from
 * stage-seeds.ts at creation. Migration 024 added `stage_key` / `substage_key` and
 * backfilled every existing row, so display can go through the dictionary.
 *
 * The stored `name` remains the fallback. A row whose key the backfill could not match
 * (a name edited outside the app, or a seed string changed without regenerating the
 * migration) keeps a NULL key and still renders its English name — never a blank cell or
 * a raw key like `substages.floorDecking`.
 *
 * One helper rather than an inline `t()` at each of the ~9 render sites, so the fallback
 * rule cannot drift between the Stages tab, Timeline, Payments, certificates and the PDF.
 */
export function useStageLabels() {
  const t = useT();

  const stageLabel = useCallback(
    (stage: Pick<ProjectStageRow, 'stage_key' | 'name'>): string => {
      if (!stage.stage_key) return stage.name;
      const translated = t(`stages.${stage.stage_key}` as TKey);
      // t() returns the key itself when it is missing, which would be worse than English.
      return translated === `stages.${stage.stage_key}` ? stage.name : translated;
    },
    [t],
  );

  const substageLabel = useCallback(
    (sub: Pick<ProjectSubstageRow, 'substage_key' | 'name'>): string => {
      if (!sub.substage_key) return sub.name;
      // `floorDecking` carries {n}; the number is already baked into the stored name, so
      // parse it back out rather than plumbing params through every caller.
      const params = sub.substage_key === 'floorDecking'
        ? { n: Number(/\d+/.exec(sub.name)?.[0] ?? 1) }
        : undefined;
      const translated = t(`substages.${sub.substage_key}` as TKey, params);
      return translated === `substages.${sub.substage_key}` ? sub.name : translated;
    },
    [t],
  );

  return { stageLabel, substageLabel };
}
