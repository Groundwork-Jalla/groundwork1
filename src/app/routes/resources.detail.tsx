import { Link, useParams } from 'react-router';
import { ArrowLeft, BookOpen, CheckSquare, Scale, Video, Clock } from 'lucide-react';
import type { ResourceCategory, ResourceTag } from '@/lib/resources-data';
import { useResources } from '@/lib/resources-labels';
import { useT } from '@/lib/i18n';

// ── Icon map ───────────────────────────────────────────────

const CATEGORY_ICONS: Record<ResourceCategory, React.ComponentType<{ className?: string }>> = {
  guides:       BookOpen,
  checklists:   CheckSquare,
  legalFinance: Scale,
  videos:       Video,
};

// ── Tag colours ────────────────────────────────────────────

const TAG_COLORS: Record<ResourceTag, string> = {
  popular:   'bg-brand-off-white text-state-active border border-state-active/30 dark:bg-state-active/50 dark:text-state-active dark:border-state-active',
  essential: 'bg-brand-near-black text-white border-transparent dark:bg-white dark:text-brand-near-black',
  new:       'bg-brand-off-white text-state-complete border border-state-complete/30 dark:bg-state-complete/50 dark:text-state-complete dark:border-state-complete',
  important: 'bg-brand-off-white text-state-held border border-state-held/30 dark:bg-state-held/50 dark:text-state-held dark:border-state-held',
  startHere: 'bg-brand-off-white text-state-active border border-state-active/30 dark:bg-state-active/50 dark:text-state-active dark:border-state-active',
};

// ── Page ───────────────────────────────────────────────────

export default function ResourceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const t = useT();
  const { all, bySlug, stageName } = useResources();
  const resource = bySlug(slug);

  if (!resource) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
        <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('resources.notFound')}</p>
        <p className="text-xs text-brand-mid-grey dark:text-white/60 mb-6">
          {t('resources.notFoundBody')}
        </p>
        <Link
          to="/resources"
          className="text-sm font-medium text-brand-near-black dark:text-white underline underline-offset-2"
        >
          ← {t('resources.backToList')}
        </Link>
      </div>
    );
  }

  const CategoryIcon = CATEGORY_ICONS[resource.category];
  const related = all
    .filter(r => r.category === resource.category && r.slug !== resource.slug)
    .slice(0, 3);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">

      {/* Back link */}
      <Link
        to="/resources"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey dark:text-white/60 hover:text-brand-near-black dark:hover:text-white transition-colors mb-6"
      >
        <ArrowLeft className="size-3.5" /> {t('resources.title')}
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_272px] gap-8 items-start">

        {/* ── Main article ───────────────────────────────── */}
        <article>

          {/* Badge row */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {resource.tag && (
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${TAG_COLORS[resource.tag]}`}>
                {resource.tagLabel}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-brand-off-white dark:bg-[#2c2c2c] text-brand-mid-grey dark:text-white/60 border border-brand-border-grey dark:border-[#3c3c3c]">
              <CategoryIcon className="size-3" />
              {resource.categoryLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-brand-off-white dark:bg-[#2c2c2c] text-brand-mid-grey dark:text-white/60 border border-brand-border-grey dark:border-[#3c3c3c]">
              <Clock className="size-3" />
              {resource.readTime}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-3xl font-bold text-brand-near-black dark:text-white leading-tight mb-3">
            {resource.title}
          </h1>

          {/* Stage badge */}
          {resource.stage !== null && (
            <div className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-light-grey dark:bg-[#2c2c2c] text-brand-mid-grey dark:text-white/60 border border-brand-border-grey dark:border-[#3c3c3c] mb-5">
              {t('resources.relevantStage', { n: resource.stage, name: stageName(resource.stage) })}
            </div>
          )}

          {/* Divider */}
          <hr className="border-brand-border-grey dark:border-[#2c2c2c] mb-6" />

          {/* Content */}
          <div className="space-y-4">
            {resource.content.map((para, i) => (
              <p
                key={i}
                className="text-sm text-brand-near-black dark:text-white/80 leading-relaxed"
              >
                {para}
              </p>
            ))}
          </div>
        </article>

        {/* ── Sidebar ────────────────────────────────────── */}
        {related.length > 0 && (
          <aside className="lg:sticky lg:top-6">
            <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
              <p className="text-[10px] font-semibold text-brand-mid-grey dark:text-white/60 uppercase tracking-wider mb-4">
                {t('resources.relatedIn', { category: resource.categoryLabel })}
              </p>
              <div className="space-y-2.5">
                {related.map(rel => {
                  const RelIcon = CATEGORY_ICONS[rel.category];
                  return (
                    <Link
                      key={rel.slug}
                      to={`/resources/${rel.slug}`}
                      className="block group rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] hover:border-brand-near-black dark:hover:border-white/30 p-3.5 transition-colors"
                    >
                      <p className="text-xs font-semibold text-brand-near-black dark:text-white leading-snug group-hover:underline underline-offset-2 mb-1.5">
                        {rel.title}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] text-brand-mid-grey dark:text-white/40">
                        <RelIcon className="size-3 shrink-0" />
                        <span>{rel.readTime}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
