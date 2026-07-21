import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import {
  BookOpen, FileText, CheckSquare, Video, Building2, Scale, ArrowRight, Clock,
} from 'lucide-react';
import { RESOURCES } from '@/lib/resources-data';
import type { ResourceCategory } from '@/lib/resources-data';

// ── Icon map ───────────────────────────────────────────────

const CATEGORY_ICONS: Record<ResourceCategory, React.ComponentType<{ className?: string }>> = {
  'Guides':         BookOpen,
  'Checklists':     CheckSquare,
  'Legal & Finance': Scale,
  'Videos':         Video,
};

// ── Filter lists ───────────────────────────────────────────

const CATEGORIES: Array<'All' | ResourceCategory> = [
  'All', 'Guides', 'Checklists', 'Legal & Finance', 'Videos',
];

// ── Tag colours ────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  Popular:      'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800',
  Essential:    'bg-brand-near-black text-white border-transparent dark:bg-white dark:text-brand-near-black',
  New:          'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-800',
  Important:    'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  'Start here': 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800',
};

// ── Pill button ────────────────────────────────────────────

function Pill({
  active, onClick, children,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-brand-near-black text-white border-brand-near-black dark:bg-white dark:text-brand-near-black dark:border-white'
          : 'bg-white text-brand-mid-grey border-brand-border-grey hover:border-brand-near-black hover:text-brand-near-black dark:bg-[#1e1e1e] dark:text-white/60 dark:border-[#2c2c2c] dark:hover:border-white/40 dark:hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ── Page ───────────────────────────────────────────────────

export default function ResourcesPage() {
  const [activeCategory, setActiveCategory] = useState<'All' | ResourceCategory>('All');
  const [activeStage, setActiveStage]       = useState<number | 'All'>('All');

  // Only show stage pills for stages that have at least one resource
  const availableStages = useMemo(() => {
    const seen = new Set<number>();
    RESOURCES.forEach(r => { if (r.stage !== null) seen.add(r.stage); });
    return Array.from(seen).sort((a, b) => a - b);
  }, []);

  const filtered = useMemo(() => {
    return RESOURCES.filter(r => {
      const catOk   = activeCategory === 'All' || r.category === activeCategory;
      const stageOk = activeStage   === 'All' || r.stage    === activeStage;
      return catOk && stageOk;
    });
  }, [activeCategory, activeStage]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-brand-near-black dark:text-white">Resources</h2>
        <p className="text-xs text-brand-mid-grey dark:text-white/60 mt-0.5">
          Guides, checklists, and templates to help you build with confidence
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-2.5">
        {/* Category */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <Pill
              key={cat}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Pill>
          ))}
        </div>
        {/* Stage */}
        <div className="flex flex-wrap gap-2">
          <Pill active={activeStage === 'All'} onClick={() => setActiveStage('All')}>
            All Stages
          </Pill>
          {availableStages.map(stage => (
            <Pill
              key={stage}
              active={activeStage === stage}
              onClick={() => setActiveStage(stage)}
            >
              Stage {stage}
            </Pill>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(item => {
            const Icon = CATEGORY_ICONS[item.category];
            return (
              <Link
                key={item.slug}
                to={`/resources/${item.slug}`}
                className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] p-5 flex flex-col gap-2 hover:border-brand-near-black dark:hover:border-white/30 transition-colors group"
              >
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-near-black dark:text-white leading-snug">
                    {item.title}
                  </p>
                  {item.tag && (
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${TAG_COLORS[item.tag] ?? 'bg-brand-off-white text-brand-mid-grey'}`}>
                      {item.tag}
                    </span>
                  )}
                </div>

                {/* Description */}
                <p className="text-xs text-brand-mid-grey dark:text-white/60 leading-relaxed">
                  {item.desc}
                </p>

                {/* Footer row */}
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-brand-mid-grey dark:text-white/40 shrink-0" />
                    <span className="text-[10px] text-brand-mid-grey dark:text-white/40">{item.category}</span>
                    <span className="text-brand-mid-grey/40 dark:text-white/20 select-none">·</span>
                    <Clock className="size-3 text-brand-mid-grey dark:text-white/40 shrink-0" />
                    <span className="text-[10px] text-brand-mid-grey dark:text-white/40">{item.readTime}</span>
                  </div>
                  <ArrowRight className="size-3.5 text-brand-mid-grey dark:text-white/40 group-hover:text-brand-near-black dark:group-hover:text-white transition-colors shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] px-6 py-12 text-center">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">No resources found</p>
          <p className="text-xs text-brand-mid-grey dark:text-white/60">Try adjusting the filters above.</p>
        </div>
      )}

      {/* Missing something? */}
      <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white dark:bg-[#2c2c2c]">
          <Building2 className="size-5 text-brand-mid-grey dark:text-white/60" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-0.5">Missing something?</p>
          <p className="text-xs text-brand-mid-grey dark:text-white/60 leading-relaxed">
            If there's a guide, template, or checklist you'd find useful, let us know and we'll prioritise it.
          </p>
        </div>
        <a
          href="mailto:hello@jalla.build"
          className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] text-sm font-medium text-brand-near-black dark:text-white px-4 py-2 hover:bg-brand-off-white dark:hover:bg-[#2c2c2c] transition-colors"
        >
          <FileText className="size-4" /> Suggest a resource
        </a>
      </div>
    </div>
  );
}
