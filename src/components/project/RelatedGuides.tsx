import { Link } from 'react-router';
import { ArrowRight, Clock } from 'lucide-react';
import type { ResourceCategory } from '@/lib/resources-data';
import { useResources, type Resource } from '@/lib/resources-labels';
import { useT } from '@/lib/i18n';

export type GuideTab = 'overview' | 'stages' | 'costing' | 'timeline' | 'payments' | 'documents' | 'messages';

const TAB_SLUGS: Record<GuideTab, string[]> = {
  overview:  ['understanding-build-stages', 'diaspora-builders-checklist', 'groundwork-walkthrough'],
  stages:    ['stage-approval-checklist', 'site-visit-checklist', 'reading-site-evidence'],
  costing:   ['how-to-read-a-bq', 'contractor-payment-template', 'currency-transfer-tips'],
  timeline:  ['understanding-build-stages', 'building-permit-process', 'hiring-a-contractor'],
  payments:  ['contractor-payment-template', 'how-to-read-a-bq', 'currency-transfer-tips'],
  documents: ['title-deed-verification', 'building-permit-process', 'stage-approval-checklist'],
  messages:  ['hiring-a-contractor', 'reading-site-evidence', 'site-visit-checklist'],
};

// One neutral chip for every category. The category is already spelled out in the
// chip; a hue per category added nothing a reader could act on, and it competed with
// the stage-status colours on the same screen. Kept as a map rather than collapsed to
// a constant so a category can be given emphasis later without restructuring callers.
const CATEGORY_STYLE: Record<ResourceCategory, string> = {
  guides:       'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey',
  checklists:   'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey',
  legalFinance: 'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey',
  videos:       'bg-brand-off-white dark:bg-[#252525] text-brand-mid-grey',
};

interface RelatedGuidesProps {
  tab: GuideTab;
  currentStage?: number;
}

export default function RelatedGuides({ tab, currentStage }: RelatedGuidesProps) {
  const t = useT();
  const { all } = useResources();
  let guides: Resource[];

  if (tab === 'stages' && currentStage) {
    const byStage = all.filter(r => r.stage === currentStage).slice(0, 3);
    if (byStage.length >= 2) {
      guides = byStage;
    } else {
      const defaults = TAB_SLUGS.stages
        .map(s => all.find(r => r.slug === s))
        .filter(Boolean) as Resource[];
      guides = [
        ...byStage,
        ...defaults.filter(d => !byStage.find(b => b.slug === d.slug)),
      ].slice(0, 3);
    }
  } else {
    guides = TAB_SLUGS[tab]
      .map(slug => all.find(r => r.slug === slug))
      .filter(Boolean) as Resource[];
  }

  if (guides.length === 0) return null;

  return (
    <div className="mt-8 border-t border-brand-border-grey dark:border-[#2c2c2c] pt-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.guides.title')}</p>
        <Link
          to="/resources"
          className="flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white transition-colors"
        >
          {t('project.guides.viewAll')} <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {guides.map(guide => (
          <Link
            key={guide.slug}
            to={`/resources/${guide.slug}`}
            className="group rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4 flex flex-col gap-2 hover:border-brand-near-black dark:hover:border-[#555] transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_STYLE[guide.category]}`}>
                {guide.categoryLabel}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-brand-mid-grey shrink-0">
                <Clock className="size-2.5" /> {guide.readTime}
              </span>
            </div>
            <p className="text-xs font-semibold text-brand-near-black dark:text-white leading-snug group-hover:underline underline-offset-2">
              {guide.title}
            </p>
            <p className="text-[10px] text-brand-mid-grey leading-relaxed line-clamp-2">{guide.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
