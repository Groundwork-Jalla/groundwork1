import { useCallback, useMemo } from 'react';
import { useT, type TKey } from '@/lib/i18n';
import {
  RESOURCE_META, RESOURCE_STAGE_KEYS,
  type ResourceCategory, type ResourceMeta, type ResourceTag,
} from '@/lib/resources-data';

/** A resource with its prose resolved for the current language. */
export interface Resource extends ResourceMeta {
  title: string;
  desc: string;
  /** "8 min read", or plain "8 min" for videos — nobody *reads* a video. */
  readTime: string;
  categoryLabel: string;
  tagLabel: string | null;
  /** Body paragraphs, in order. */
  content: string[];
}

export function useResources() {
  const t = useT();

  const categoryLabel = useCallback(
    (c: ResourceCategory) => t(`resources.categories.${c}` as TKey),
    [t],
  );

  const tagLabel = useCallback(
    (tag: ResourceTag | null) => (tag ? t(`resources.tags.${tag}` as TKey) : null),
    [t],
  );

  /** Stage name for the "Relevant: Stage N" badge, from the project stage vocabulary. */
  const stageName = useCallback(
    (stage: number) => {
      const key = RESOURCE_STAGE_KEYS[stage];
      return key ? t(`stages.${key}` as TKey) : String(stage);
    },
    [t],
  );

  const resolve = useCallback(
    (meta: ResourceMeta): Resource => ({
      ...meta,
      title: t(`resources.articles.${meta.key}.title` as TKey),
      desc:  t(`resources.articles.${meta.key}.desc` as TKey),
      readTime: meta.category === 'videos'
        ? t('resources.minWatch', { n: meta.minutes })
        : t('resources.minRead',  { n: meta.minutes }),
      categoryLabel: categoryLabel(meta.category),
      tagLabel: tagLabel(meta.tag),
      content: Array.from(
        { length: meta.paragraphs },
        (_, i) => t(`resources.articles.${meta.key}.p${i + 1}` as TKey),
      ),
    }),
    [t, categoryLabel, tagLabel],
  );

  const all = useMemo(() => RESOURCE_META.map(resolve), [resolve]);

  const bySlug = useCallback(
    (slug: string | undefined) => all.find(r => r.slug === slug),
    [all],
  );

  return { all, bySlug, resolve, categoryLabel, tagLabel, stageName };
}
