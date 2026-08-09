import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, BadgeCheck, ShieldCheck, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUBSCRIPTIONS_ARE_PREVIEW } from '@/lib/payments/config';
import { useTierBilling } from '@/lib/tier-labels';
import { startJallaVerifyCheckout } from '@/lib/payments/subscription';
import type { ProjectTier } from '@/types/project';
import { useT } from '@/lib/i18n';

// =========================================================
// Design A — three plans side by side.
//
// The comparison IS the screen: someone choosing a plan is asking "what do I lose
// by staying free", and that question is answered by reading across, not by
// clicking a tab and holding the previous column in your head. Jalla Verify is the
// dark column because it is the one plan we are actually selling.
//
// Below `md` the columns stack, which turns it back into a scroll-through list —
// the same information, in the order the recommendation implies.
// =========================================================

const ORDER: ProjectTier[] = ['self_verify', 'jalla_verify', 'jalla_management'];

const ICON: Record<ProjectTier, React.ReactNode> = {
  self_verify:      <BadgeCheck className="size-4" />,
  jalla_verify:     <ShieldCheck className="size-4" />,
  jalla_management: <Briefcase className="size-4" />,
};

/** The one plan with a Stripe checkout. The others are free, or a negotiation. */
const SELLABLE: ProjectTier = 'jalla_verify';

export default function UpgradeScreen({ currentTier }: { currentTier?: ProjectTier }) {
  const t = useT();
  const tiers = useTierBilling();
  const [busy, setBusy]   = useState<ProjectTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Only Jalla Verify is self-serve. Self Verify is the free default — there is nothing
   * to buy — and Jalla Management is a negotiated contract, so it goes to sales rather
   * than to Stripe.
   */
  async function handleCta(tier: ProjectTier) {
    setError(null);
    if (tier === 'self_verify') return;
    if (tier === 'jalla_management') {
      window.location.href = 'mailto:hello@tryjalla.com?subject=Jalla%20Management%20enquiry';
      return;
    }
    setBusy(tier);
    try {
      await startJallaVerifyCheckout();   // redirects to Stripe; nothing after this runs
    } catch (err) {
      setError(err instanceof Error ? err.message : t('project.payments.checkoutFailed'));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-9 text-center">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-mid-grey">
          {t('project.payments.selectPlan')}
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white sm:text-3xl">
          {t('project.payments.howBuild')}
        </h1>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
        {ORDER.map((id, i) => {
          const d         = tiers[id];
          const featured  = id === SELLABLE;
          const isCurrent = currentTier === id;
          const isBusy    = busy === id;

          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.06 * i, ease: 'easeOut' }}
              className={cn(
                'relative flex h-full flex-col rounded-2xl border p-7',
                featured
                  ? 'border-brand-near-black bg-brand-near-black text-white shadow-[0_12px_40px_rgba(0,0,0,0.14)]'
                  : 'border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
              )}
            >
              {d.tag && (
                <span className={cn(
                  'absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em]',
                  featured ? 'bg-white text-brand-near-black' : 'bg-brand-near-black text-white',
                )}>
                  {d.tag}
                </span>
              )}

              <div className={cn('mb-1 flex items-center gap-2', featured ? 'text-white/70' : 'text-brand-mid-grey')}>
                {ICON[id]}
                <span className="text-sm font-bold">{d.name}</span>
              </div>

              <div className="mb-2.5 flex items-baseline gap-1">
                <span className="text-4xl font-black tracking-tight">{d.price}</span>
                {d.period && (
                  <span className={cn('text-sm', featured ? 'text-white/50' : 'text-brand-mid-grey')}>{d.period}</span>
                )}
              </div>

              <p className={cn('mb-5 text-xs leading-relaxed', featured ? 'text-white/55' : 'text-brand-mid-grey')}>
                {d.desc}
              </p>

              <div className="flex flex-1 flex-col gap-2.5">
                {d.features.map(f => (
                  <div key={f} className="flex items-start gap-2.5">
                    {/* Monochrome tick — a feature being present is not a status. */}
                    <span className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
                      featured ? 'bg-white/15' : 'bg-brand-off-white dark:bg-[#252525]',
                    )}>
                      <Check className={cn('size-2.5 stroke-3', featured ? 'text-white' : 'text-brand-near-black dark:text-white')} />
                    </span>
                    <span className={cn('text-xs leading-snug', featured ? 'text-white/85' : 'text-brand-near-black dark:text-white')}>
                      {f}
                    </span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={isCurrent || isBusy}
                onClick={() => handleCta(id)}
                className={cn(
                  'mt-6 w-full rounded-xl py-3.5 text-sm font-semibold transition-opacity disabled:opacity-40',
                  featured
                    ? 'bg-white text-brand-near-black hover:opacity-90'
                    : 'border-[1.5px] border-brand-near-black text-brand-near-black hover:bg-brand-off-white dark:border-white dark:text-white dark:hover:bg-[#252525]',
                )}
              >
                {isCurrent
                  ? t('project.payments.currentPlan')
                  : isBusy ? t('common.loading') : d.cta}
              </button>

              {featured && !error && (
                <p className="mt-2.5 text-center text-[11px] text-white/40">
                  {t('project.payments.cancelAnytime')}
                </p>
              )}
            </motion.div>
          );
        })}
      </div>

      {error && (
        <p className="mt-5 text-center text-[11px] text-state-alert" role="alert">{error}</p>
      )}

      {SUBSCRIPTIONS_ARE_PREVIEW && (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-brand-mid-grey">
          {t('project.payments.previewBilling')}
        </p>
      )}
    </div>
  );
}
