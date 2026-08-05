import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, BadgeCheck, ShieldCheck, Briefcase, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SUBSCRIPTIONS_ARE_PREVIEW } from '@/lib/payments/config';
import { useTierBilling } from '@/lib/tier-labels';
import { startJallaVerifyCheckout } from '@/lib/payments/subscription';
import type { ProjectTier } from '@/types/project';
import { useT } from '@/lib/i18n';

const ORDER: ProjectTier[] = ['self_verify', 'jalla_verify', 'jalla_management'];
const ICON: Record<ProjectTier, React.ReactNode> = {
  self_verify: <BadgeCheck className="size-4" />,
  jalla_verify: <ShieldCheck className="size-4" />,
  jalla_management: <Briefcase className="size-4" />,
};

export default function UpgradeScreen({ currentTier }: { currentTier?: ProjectTier }) {
  const t = useT();
  const tiers = useTierBilling();
  const [sel, setSel] = useState<ProjectTier>('jalla_verify');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = tiers[sel];
  const isCurrent = currentTier === sel;

  /**
   * Only Jalla Verify is self-serve. Self Verify is the free default — there is nothing
   * to buy — and Jalla Management is a negotiated contract, so it goes to sales rather
   * than to Stripe.
   */
  async function handleCta() {
    setError(null);
    if (sel === 'self_verify') return;
    if (sel === 'jalla_management') {
      window.location.href = 'mailto:hello@tryjalla.com?subject=Jalla%20Management%20enquiry';
      return;
    }
    setBusy(true);
    try {
      await startJallaVerifyCheckout();   // redirects to Stripe; nothing after this runs
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Dark hero + segmented toggle */}
      <div className="rounded-2xl bg-brand-near-black text-white text-center px-7 pt-9 pb-7 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40 mb-1.5">{t('project.payments.selectPlan')}</p>
        <h1 className="text-2xl sm:text-[26px] font-extrabold tracking-tight mb-5">{t('project.payments.howBuild')}</h1>
        <div className="flex gap-1 rounded-xl bg-white/[0.08] p-1">
          {ORDER.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => setSel(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-colors',
                sel === id ? 'bg-white text-brand-near-black' : 'text-white/50 hover:text-white/80',
              )}
            >
              {ICON[id]}
              {tiers[id].short}
            </button>
          ))}
        </div>
      </div>

      {/* Revealed plan card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={sel}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] shadow-[0_8px_32px_rgba(0,0,0,0.06)] p-7 text-center"
        >
          {d.tag && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-off-white dark:bg-[#252525] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-mid-grey mb-4">
              <Sparkles className="size-3" /> {d.tag}
            </span>
          )}
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-5xl font-black tracking-tight text-brand-near-black dark:text-white">{d.price}</span>
            {d.period && <span className="text-base text-brand-mid-grey">{d.period}</span>}
          </div>
          <p className="text-lg font-bold text-brand-near-black dark:text-white mt-1.5">{d.name}</p>
          <p className="text-sm text-brand-mid-grey mt-1.5 leading-relaxed max-w-sm mx-auto">{d.desc}</p>

          <div className="h-px bg-brand-border-grey dark:bg-[#2c2c2c] my-6" />

          <div className="text-left space-y-3">
            {d.features.map(f => (
              <div key={f} className="flex items-center gap-2.5">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <Check className="size-2.5 text-green-600 dark:text-green-400 stroke-[3]" />
                </span>
                <span className="text-sm text-brand-near-black dark:text-white">{f}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            disabled={isCurrent || busy}
            onClick={handleCta}
            className="mt-6 w-full rounded-xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-sm font-semibold py-3.5 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {isCurrent
              ? t('project.payments.currentPlan')
              : busy ? t('common.loading') : d.cta}
          </button>

          {error && (
            <p className="text-[11px] text-state-alert mt-2.5" role="alert">{error}</p>
          )}

          {sel === 'jalla_verify' && !error && (
            <p className="text-[11px] text-brand-mid-grey mt-2.5">{t('project.payments.cancelAnytime')}</p>
          )}
        </motion.div>
      </AnimatePresence>

      {SUBSCRIPTIONS_ARE_PREVIEW && (
        <p className="text-[11px] text-brand-mid-grey text-center mt-5 leading-relaxed">
          {t('project.payments.previewBilling')}
        </p>
      )}
    </div>
  );
}
