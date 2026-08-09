import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Download } from 'lucide-react';
import { formatUSDFull, formatLocalCurrency } from '@/lib/budget';
import { useFormat, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ProjectStageRow, ProjectTier, ConstructionRate } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';

export default function PayoutStatusModal({
  open, stage, rate, contractorLabel, onClose,
}: {
  open: boolean;
  stage: ProjectStageRow | null;
  rate: ConstructionRate | null;
  contractorLabel: string;
  onClose: () => void;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const f = useFormat();

  // Every hook above this line — see MilestonePaymentModal for why.
  if (!stage) return null;

  const amount   = stage.payment_milestone_usd ?? 0;
  const localAmt = rate ? amount * rate.approx_fx_rate : null;
  const fx       = rate?.approx_fx_rate ?? null;
  const ccy      = rate?.currency_code ?? 'XAF';
  const paid     = stage.payment_status === 'paid';

  const nodes = [
    { label: t('project.payments.nodeReceived'),   sub: formatUSDFull(amount) },
    { label: t('project.payments.nodePayoutSent'), sub: formatUSDFull(amount) },
    { label: t('project.payments.nodeConverting'), sub: `→ ${ccy}` },
    { label: t('project.payments.nodeDelivered'),  sub: localAmt !== null ? formatLocalCurrency(localAmt, ccy) : '—' },
  ];
  // Unpaid stages have only reached "received"; paid ones ran the whole chain.
  const doneCount = paid ? nodes.length : 1;

  const fmtDateTime = f.date(stage.completed_at);

  const details: [string, string][] = [
    [t('project.payments.contractor'), contractorLabel],
    [t('project.payments.phone'), t('project.payments.notOnFile')],
    [t('project.payments.method'), t('project.payments.methodValue')],
    [t('project.payments.amountSent'), `${formatUSDFull(amount)} USD`],
    [t('project.payments.amountReceived'), localAmt !== null ? formatLocalCurrency(localAmt, ccy) : '—'],
    [t('project.payments.exchangeRate'), fx ? `1 USD = ${fx} ${ccy}` : '—'],
    [t('project.payments.date'), fmtDateTime],
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
            className="w-full max-w-lg"
          >
            {/* Dark step-flow header */}
            <div className="rounded-t-2xl bg-brand-near-black text-white px-6 pt-5 pb-6 relative">
              <button type="button" onClick={onClose}
                className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 transition-colors">
                <X className="size-4" />
              </button>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">{t('project.payments.payoutTracker')}</p>
                  <h2 className="text-lg font-extrabold mt-1">{t('project.stages.stageN', { n: stage.stage_number })}: {stageLabel(stage)}</h2>
                </div>
                <span className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold',
                  paid ? 'bg-brand-off-white text-state-complete' : 'bg-brand-off-white text-state-active',
                )}>
                  {paid ? t('project.payments.delivered') : t('project.payments.inTransit')}
                </span>
              </div>

              <div className="flex items-start">
                {nodes.map((n, i) => {
                  const done = i < doneCount;
                  return (
                    <div key={n.label} className="flex items-start flex-1">
                      <div className="flex flex-col items-center flex-1">
                        <div className={cn(
                          'flex size-9 items-center justify-center rounded-full text-xs font-extrabold',
                          done ? 'bg-white text-brand-near-black' : 'bg-white/10 text-white/30',
                        )}>
                          {done ? <Check className="size-4" /> : i + 1}
                        </div>
                        <p className={cn('text-[10px] font-semibold mt-1.5 text-center', done ? 'text-white' : 'text-white/30')}>{n.label}</p>
                        <p className="text-[9px] text-white/40 mt-0.5 text-center tabular-nums">{n.sub}</p>
                      </div>
                      {i < nodes.length - 1 && (
                        <div className={cn('h-0.5 flex-1 mt-[18px] -mx-1', i < doneCount - 1 ? 'bg-white/25' : 'bg-white/[0.06]')} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detail card */}
            <div className="rounded-b-2xl border-x border-b border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-brand-mid-grey mb-3">{t('project.payments.details')}</p>
              {details.map(([l, v], i) => (
                <div key={l} className={cn(
                  'flex justify-between py-2 text-[13px]',
                  i < details.length - 1 && 'border-b border-brand-light-grey dark:border-[#252525]',
                )}>
                  <span className="text-brand-mid-grey">{l}</span>
                  <span className="font-semibold text-brand-near-black dark:text-white tabular-nums truncate ml-3 max-w-[60%] text-right">{v}</span>
                </div>
              ))}
              <button type="button"
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] py-2.5 text-xs font-semibold text-brand-near-black dark:text-white hover:bg-brand-off-white dark:hover:bg-[#252525] transition-colors">
                <Download className="size-3.5" /> {t('project.payments.downloadReceipt')}
              </button>
              <p className="text-[10px] text-brand-soft-grey text-center mt-2.5">{t('project.payments.payoutPreview')}</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
