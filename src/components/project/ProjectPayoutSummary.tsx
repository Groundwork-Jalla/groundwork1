import { useEffect, useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { fetchStagePaymentsStrict, type StagePayment } from '@/lib/supabase/verifications';
import { receiptPayoutSummary } from '@/lib/payments/receipt-payouts';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import { projectBudget } from '@/lib/budget';
import { projectMoneyBasis } from '@/lib/budget/project-money';

interface Props {
  project: ProjectRow;
  stages: ProjectStageRow[];
  /** A refreshed stage ledger also refreshes these figures after an upload/confirmation. */
  refreshKey?: unknown;
  tone?: 'default' | 'hero' | 'calm';
  compact?: boolean;
}

/** Direct client-to-contractor payments, shown identically to both participants. */
export function ProjectPayoutSummary({ project, stages, refreshKey, tone = 'default', compact = false }: Props) {
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stage_payment_receipts', filter: `project_id=eq.${project.id}` }, () => { void refresh(); })
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
  const basis = projectMoneyBasis(project);
  const currency = summary?.currency ?? basis.code;
  const format = (amount: number) => currency === 'USD' ? `$${number(amount)}` : `${number(amount)} ${currency}`;
  const metrics = [
    { key: 'payouts' as const, value: summary && summary.missingConfirmedCount === 0 ? summary.payouts : null },
    { key: 'pendingReceipts' as const, value: summary && summary.missingPendingCount === 0 ? summary.pending : null },
    { key: 'currentStagePayment' as const, value: summary?.currentStage ?? null },
    { key: 'remainingBudget' as const, value: summary?.remaining ?? null },
  ];

  if (tone === 'calm') {
    const budget = basis.locked && project.budget_amount != null ? project.budget_amount : projectBudget(project).total * basis.rate;
    const primary = [
      { label: t('dashboard.totalBudget'), value: Number.isFinite(budget) ? budget : null },
      { label: t('project.receiptFlow.receivedTotal'), value: summary && summary.missingConfirmedCount === 0 ? summary.payouts.amount : null },
      { label: t('project.costing.remainingBudget'), value: summary?.remaining?.amount ?? null },
    ];
    return <section aria-label={t('project.costing.payouts')} className="space-y-3">
      <dl className="grid min-w-0 divide-y divide-brand-border-grey rounded-xl border border-brand-border-grey bg-white lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {primary.map(metric => <div key={metric.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 lg:block lg:px-5 lg:py-5">
          <dt className="text-xs leading-relaxed text-brand-mid-grey">{metric.label}</dt>
          <dd className="max-w-full break-words font-mono text-sm font-semibold leading-relaxed text-brand-near-black sm:text-base lg:mt-2 xl:text-lg">{metric.value == null ? '—' : format(metric.value)}</dd>
        </div>)}
      </dl>
      {state === 'loading' && <p role="status" className="text-xs text-brand-mid-grey">{t('common.loading')}</p>}
      {state === 'error' && <p role="alert" className="text-xs text-state-alert">{t('project.costing.payoutsLoadFailed')}{' '}<button type="button" onClick={() => setAttempt(value => value + 1)} className="font-semibold underline">{t('project.costing.retryPayouts')}</button></p>}
      {summary && (summary.missingConfirmedCount > 0 || summary.missingPendingCount > 0) && <p role="status" className="text-xs text-brand-mid-grey">{t('project.costing.receiptAmountsMissing')}</p>}
      {summary?.overBudget && summary.overBudget.amount > 0 && <p role="status" className="text-xs text-state-alert">{t('project.costing.overBudget', { amount: format(summary.overBudget.amount) })}</p>}
      <details className="text-xs text-brand-mid-grey">
        <summary className="min-h-8 cursor-pointer py-1 font-medium text-brand-green dark:text-[#b4d8bf]">{t('dashboard.architecture.financialDetails')}</summary>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">{metrics.filter(metric => metric.key === 'pendingReceipts' || metric.key === 'currentStagePayment').map(metric => <div key={metric.key}>
          <dt>{t(`project.costing.${metric.key}`)}</dt><dd className="mt-1 break-words font-mono">{metric.value ? format(metric.value.amount) : '—'}</dd>
          {metric.value && currency !== 'USD' && <dd className="mt-1 font-mono">≈ ${number(metric.value.usd, 2)}</dd>}
        </div>)}</dl>
        <p className="mt-3 leading-relaxed">{t('project.costing.payoutsNote')}</p>
      </details>
    </section>;
  }

  return (
    <section aria-label={t('project.costing.payouts')} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {metrics.map(metric => (
          <div key={metric.key} className={tone === 'hero' ? 'flex flex-col gap-1 rounded-xl bg-white/10 p-3' : compact ? 'flex min-w-0 flex-col gap-1 py-2' : 'flex flex-col gap-1 rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]'}>
            <span className={tone === 'hero' ? 'text-xs text-white/75' : 'text-xs text-brand-mid-grey'}>{t(`project.costing.${metric.key}`)}</span>
            <span className={`font-mono ${compact ? 'text-sm' : 'text-lg'} font-semibold tabular-nums ${tone === 'hero' ? 'text-white' : 'text-brand-near-black dark:text-white'}`}>
              {metric.value ? format(metric.value.amount) : '—'}
            </span>
            {metric.value && summary?.currency !== 'USD' && (
              <span className={`font-mono text-xs ${tone === 'hero' ? 'text-white/70' : 'text-brand-mid-grey'}`}>≈ ${number(metric.value.usd, 2)}</span>
            )}
          </div>
        ))}
      </div>
      {state === 'loading' && <p role="status" className={tone === 'hero' ? 'text-xs text-white/75' : 'text-xs text-brand-mid-grey'}>{t('common.loading')}</p>}
      {state === 'error' && (
        <p role="alert" className={tone === 'hero' ? 'text-xs font-medium text-white' : 'text-xs text-state-alert'}>
          {t('project.costing.payoutsLoadFailed')}{' '}
          <button type="button" onClick={() => setAttempt(value => value + 1)} className="font-semibold underline">{t('project.costing.retryPayouts')}</button>
        </p>
      )}
      {summary && (summary.missingConfirmedCount > 0 || summary.missingPendingCount > 0) && (
        <p role="status" className={tone === 'hero' ? 'text-xs text-white/75' : 'text-xs text-brand-mid-grey'}>{t('project.costing.receiptAmountsMissing')}</p>
      )}
      {summary?.overBudget && summary.overBudget.amount > 0 && (
        <p role="status" className={tone === 'hero' ? 'text-xs font-medium text-white' : 'text-xs text-state-alert'}>{t('project.costing.overBudget', { amount: format(summary.overBudget.amount) })}</p>
      )}
      <p className={`text-[11px] leading-relaxed ${tone === 'hero' ? 'text-white/75' : 'text-brand-mid-grey'}`}>{t('project.costing.payoutsNote')}</p>
    </section>
  );
}
