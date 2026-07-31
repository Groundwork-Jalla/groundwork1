import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Loader2, CreditCard, ShieldCheck, Lock, ArrowDown, Banknote, Check,
} from 'lucide-react';
import { formatUSDFull, formatLocalCurrency } from '@/lib/budget';
import { platformFee, stripeProcessing } from '@/lib/payments/config';
import type { ProjectStageRow, ProjectTier } from '@/types/project';
import type { ConstructionRate } from '@/types/project';

export default function MilestonePaymentModal({
  open, stage, tier, rate, projectName, contractorLabel, onConfirm, onClose,
}: {
  open: boolean;
  stage: ProjectStageRow | null;
  tier: ProjectTier;
  rate: ConstructionRate | null;
  projectName: string;
  contractorLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  if (!stage) return null;

  const amount    = stage.payment_milestone_usd ?? 0;
  const fee       = platformFee(amount, tier);
  const youPay    = amount + fee;
  const stripeEst = stripeProcessing(youPay);
  const localAmt  = rate ? amount * rate.approx_fx_rate : null;

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const flow = [
    { icon: <CreditCard className="size-4" />, label: 'You pay',          value: formatUSDFull(youPay), sub: `inc. ${(fee > 0 ? formatUSDFull(fee) : 'no')} fee` },
    { icon: <Lock className="size-4" />,        label: 'Platform holds',   value: formatUSDFull(amount), sub: 'in escrow' },
    { icon: <Banknote className="size-4" />,    label: 'Contractor gets',  value: localAmt !== null && rate ? formatLocalCurrency(localAmt, rate.currency_code) : formatUSDFull(amount), sub: 'via pawaPay MoMo' },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {/* Left — money flow (dark) */}
            <div className="rounded-2xl bg-brand-near-black text-white p-6 flex flex-col justify-between">
              <div>
                <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                  Stage {stage.stage_number} of 10
                </span>
                <h2 className="text-xl font-extrabold mt-4 leading-snug">{stage.name}</h2>
                <p className="text-xs text-white/45 mt-1">{projectName}</p>

                <div className="flex flex-col gap-1 mt-6">
                  {flow.map((s, i) => (
                    <div key={s.label}>
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08]">{s.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-white/45">{s.label}</p>
                          <p className="text-base font-bold">{s.value}</p>
                        </div>
                        <span className="text-[10px] text-white/35 text-right shrink-0">{s.sub}</span>
                      </div>
                      {i < flow.length - 1 && <ArrowDown className="size-3 text-white/20 ml-2.5 my-0.5" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3">
                <div className="flex items-center justify-between text-[11px] text-white/40">
                  <span className="truncate">{contractorLabel}</span>
                  <span className="shrink-0 ml-2">Payee</span>
                </div>
              </div>
            </div>

            {/* Right — details */}
            <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-6 relative">
              <button type="button" onClick={onClose}
                className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-lg text-brand-mid-grey hover:bg-brand-off-white dark:hover:bg-[#252525] transition-colors">
                <X className="size-4" />
              </button>

              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-brand-mid-grey mb-4">Payment details</p>

              <div className="space-y-0">
                {[
                  ['Stage budget', formatUSDFull(amount), false],
                  [`Platform fee`, fee > 0 ? formatUSDFull(fee) : '—', false],
                  ['Stripe processing', `~${formatUSDFull(stripeEst)}`, true],
                ].map(([l, v, muted], i) => (
                  <div key={l as string} className={`flex justify-between py-2 text-[13px] ${i < 2 ? 'border-b border-brand-light-grey dark:border-[#252525]' : ''}`}>
                    <span className="text-brand-mid-grey">{l}</span>
                    <span className={muted ? 'text-brand-soft-grey tabular-nums' : 'font-semibold text-brand-near-black dark:text-white tabular-nums'}>{v}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-brand-near-black dark:bg-white px-4 py-3.5 my-4">
                <span className="text-[13px] font-semibold text-white dark:text-brand-near-black">Total charge</span>
                <span className="text-2xl font-black text-white dark:text-brand-near-black tabular-nums">{formatUSDFull(youPay)}</span>
              </div>

              <div className="mb-4">
                <p className="text-[11px] text-brand-mid-grey mb-1.5">Pay with</p>
                <div className="flex items-center justify-between rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-5 rounded bg-brand-near-black dark:bg-white/90" />
                    <span className="text-xs text-brand-near-black dark:text-white tabular-nums">•••• 4242</span>
                  </div>
                  <span className="text-[11px] text-brand-mid-grey">Change</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-sm font-semibold py-3.5 hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {submitting ? 'Processing…' : 'Confirm Payment'}
              </button>

              <div className="flex items-center justify-center gap-4 mt-3.5">
                {[['Encrypted', ShieldCheck], ['Held in escrow', Lock]].map(([t, Icon]) => {
                  const I = Icon as React.ComponentType<{ className?: string }>;
                  return (
                    <span key={t as string} className="flex items-center gap-1 text-[10px] text-brand-mid-grey">
                      <I className="size-3" /> {t as string}
                    </span>
                  );
                })}
              </div>
              <p className="text-[10px] text-brand-soft-grey text-center mt-2">Preview — no live charge yet. Marks the stage paid for tracking.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
