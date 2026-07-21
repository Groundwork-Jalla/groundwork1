import { Link, useParams } from 'react-router';
import { ArrowLeft, BookOpen, CheckSquare, Scale, Video, Clock } from 'lucide-react';
import { RESOURCES, STAGE_NAMES } from '@/lib/resources-data';
import type { ResourceCategory } from '@/lib/resources-data';

// ── Icon map ───────────────────────────────────────────────

const CATEGORY_ICONS: Record<ResourceCategory, React.ComponentType<{ className?: string }>> = {
  'Guides':          BookOpen,
  'Checklists':      CheckSquare,
  'Legal & Finance': Scale,
  'Videos':          Video,
};

// ── Tag colours ────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  Popular:      'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
  Essential:    'bg-brand-near-black text-white border-transparent dark:bg-white dark:text-brand-near-black',
  New:          'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800',
  Important:    'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  'Start here': 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
};

// ── Page ───────────────────────────────────────────────────

export default function ResourceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const resource = RESOURCES.find(r => r.slug === slug);

  if (!resource) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
        <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">Resource not found</p>
        <p className="text-xs text-brand-mid-grey dark:text-white/60 mb-6">
          This resource doesn't exist or may have been removed.
        </p>
        <Link
          to="/resources"
          className="text-sm font-medium text-brand-near-black dark:text-white underline underline-offset-2"
        >
          ← Back to Resources
        </Link>
      </div>
    );
  }

  const CategoryIcon = CATEGORY_ICONS[resource.category];
  const related = RESOURCES
    .filter(r => r.category === resource.category && r.slug !== resource.slug)
    .slice(0, 3);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">

      {/* Back link */}
      <Link
        to="/resources"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey dark:text-white/60 hover:text-brand-near-black dark:hover:text-white transition-colors mb-6"
      >
        <ArrowLeft className="size-3.5" /> Resources
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_272px] gap-8 items-start">

        {/* ── Main article ───────────────────────────────── */}
        <article>

          {/* Badge row */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {resource.tag && (
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${TAG_COLORS[resource.tag] ?? 'bg-brand-off-white text-brand-mid-grey'}`}>
                {resource.tag}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full bg-brand-off-white dark:bg-[#2c2c2c] text-brand-mid-grey dark:text-white/60 border border-brand-border-grey dark:border-[#3c3c3c]">
              <CategoryIcon className="size-3" />
              {resource.category}
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
              Relevant: Stage {resource.stage} — {STAGE_NAMES[resource.stage]}
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
                Related {resource.category}
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
