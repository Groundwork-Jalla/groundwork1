import { useEffect, useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { fetchStagePaymentsStrict, type StagePayment } from '@/lib/supabase/verifications';
import { receiptPayoutSummary } from '@/lib/payments/receipt-payouts';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

interface Props {
  project: ProjectRow;
  stages: ProjectStageRow[];
  /** A refreshed stage ledger also refreshes these figures after an upload/confirmation. */
  refreshKey?: unknown;
}

/** Direct client-to-contractor payments, shown identically to both participants. */
export function ProjectPayoutSummary({ project, stages, refreshKey }: Props) {
  const t = useT();
  const { lang } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{
    projectId: string;
    status: 'loading' | 'ready' | 'error';
    rows: Map<string, StagePayment>;
  }>({ projectId: project.id, status: 'loading', rows: new Map() });
  const request = useRef(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const generation = ++request.current;
      try {
        const rows = await fetchStagePaymentsStrict(project.id);
        if (active && generation === request.current) setRead({ projectId: project.id, status: 'ready', rows });
      } catch {
        if (active && generation === request.current) setRead({ projectId: project.id, status: 'error', rows: new Map() });
      }
    }
    setRead({ projectId: project.id, status: 'loading', rows: new Map() });
    void refresh();
    const channel = supabase.channel(`receipt-payouts-${project.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `project_id=eq.${project.id}` }, () => { void refresh(); })
      .subscribe();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [project.id, refreshKey, attempt]);

  const state = read.projectId === project.id ? read.status : 'loading';
  const summary = state === 'ready' ? receiptPayoutSummary(project, stages, read.rows.values()) : null;
  const number = (amount: number, digits = 6) => amount.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: digits });
  const format = (amount: number) => summary?.currency === 'USD' ? `$${number(amount)}` : `${number(amount)} ${summary?.currency}`;
  const metrics = [
    { key: 'payouts' as const, value: summary && summary.missingConfirmedCount === 0 ? summary.payouts : null },
    { key: 'pendingReceipts' as const, value: summary && summary.missingPendingCount === 0 ? summary.pending : null },
    { key: 'currentStagePayment' as const, value: summary?.currentStage ?? null },
    { key: 'remainingBudget' as const, value: summary?.remaining ?? null },
  ];

  return (
    <section aria-label={t('project.costing.payouts')} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {metrics.map(metric => (
          <div key={metric.key} className="flex flex-col gap-1 rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
            <span className="text-xs text-brand-mid-grey">{t(`project.costing.${metric.key}`)}</span>
            <span className="font-mono text-lg font-semibold tabular-nums text-brand-near-black dark:text-white">
              {metric.value ? format(metric.value.amount) : '—'}
            </span>
            {metric.value && summary?.currency !== 'USD' && (
              <span className="font-mono text-xs text-brand-mid-grey">≈ ${number(metric.value.usd, 2)}</span>
            )}
          </div>
        ))}
      </div>
      {state === 'loading' && <p role="status" className="text-xs text-brand-mid-grey">{t('common.loading')}</p>}
      {state === 'error' && (
        <p role="alert" className="text-xs text-state-alert">
          {t('project.costing.payoutsLoadFailed')}{' '}
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="font-semibold underline">{t('project.costing.retryPayouts')}</button>
        </p>
      )}
      {summary && (summary.missingConfirmedCount > 0 || summary.missingPendingCount > 0) && (
        <p role="status" className="text-xs text-brand-mid-grey">{t('project.costing.receiptAmountsMissing')}</p>
      )}
      {summary?.overBudget && summary.overBudget.amount > 0 && (
        <p role="status" className="text-xs text-state-alert">{t('project.costing.overBudget', { amount: format(summary.overBudget.amount) })}</p>
      )}
      <p className="text-[11px] leading-relaxed text-brand-mid-grey">{t('project.costing.payoutsNote')}</p>
    </section>
  );
}
