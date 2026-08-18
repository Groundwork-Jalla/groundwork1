import { Link } from 'react-router';
import { Calculator, ListChecks, CreditCard, ClipboardList, ArrowRight } from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';

// Keys, not copy — the card titles are the same strings the tool pages use as
// their own <h1>, so a wording change lands in one place for both.
const TOOLS: { to: string; icon: typeof Calculator; titleKey: TKey; descKey: TKey; ctaKey: TKey }[] = [
  {
    to: '/tools/budget',
    icon: Calculator,
    titleKey: 'tools.budgetTitle',
    descKey:  'tools.budgetCardDesc',
    ctaKey:   'tools.budgetCardCta',
  },
  {
    to: '/tools/stages',
    icon: ListChecks,
    titleKey: 'tools.stagesTitle',
    descKey:  'tools.stagesCardDesc',
    ctaKey:   'tools.stagesCardCta',
  },
  {
    to: '/tools/milestones',
    icon: CreditCard,
    titleKey: 'tools.milestonesTitle',
    descKey:  'tools.milestonesCardDesc',
    ctaKey:   'tools.milestonesCardCta',
  },
  {
    to: '/tools/tracker',
    icon: ClipboardList,
    titleKey: 'tools.trackerTitle',
    descKey:  'tools.trackerCardDesc',
    ctaKey:   'tools.trackerCardCta',
  },
];

export default function ToolsIndex() {
  const t = useT();
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      {/* Hero */}
      <div className="mb-14">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-mid-grey mb-3">{t('tools.indexTitle')}</p>
        <h1 className="text-3xl sm:text-4xl font-black text-brand-near-black dark:text-white leading-tight mb-4">
          {t('tools.indexHeadline')}<br />{t('tools.indexHeadline2')}
        </h1>
        <p className="text-base text-brand-mid-grey max-w-lg">
          {t('tools.indexSub')}
        </p>
      </div>

      {/* Tool cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {TOOLS.map(tool => {
          const Icon = tool.icon;
          return (
            <Link
              key={tool.to}
              to={tool.to}
              className="group flex flex-col gap-4 rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-6 hover:border-brand-near-black dark:hover:border-[#555] transition-colors"
            >
              <div className="size-10 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] flex items-center justify-center">
                <Icon className="size-5 text-brand-near-black dark:text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t(tool.titleKey)}</h2>
                <p className="text-xs text-brand-mid-grey leading-relaxed">{t(tool.descKey)}</p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black dark:text-white group-hover:gap-2.5 transition-all">
                {t(tool.ctaKey)} <ArrowRight className="size-3.5" />
              </span>
            </Link>
          );
        })}
      </div>

      {/* CTA strip */}
      <div className="mt-14 rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">{t('tools.fullPicture')}</p>
          <p className="text-xs text-brand-mid-grey">{t('tools.fullPictureBody')}</p>
        </div>
        <Link
          to="/auth/signup"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          {t('tools.getStartedFree')}
        </Link>
      </div>
    </div>
  );
}
