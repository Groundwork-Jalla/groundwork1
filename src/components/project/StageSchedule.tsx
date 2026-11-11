import { Check, Clock, Lock } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useStageLabels } from '@/lib/stage-labels';
import { stageScheduleUsd, type StageBasis } from '@/lib/budget/stage-amounts';
import { formatShare } from '@/lib/budget/stage-shares';
import { receiptPayoutSummary } from '@/lib/payments/receipt-payouts';
import type { StagePayment } from '@/lib/supabase/verifications';
import type { ProjectRow, ProjectStageRow } from '@/types/project';
import { MoneyValue } from './MoneyValue';

/** One schedule combines allocation, work approval and independently recorded payment. */
export function StageSchedule({ project, stages, basis, payments }: {
  project: ProjectRow; stages: ProjectStageRow[]; basis: StageBasis; payments?: Map<string, StagePayment>;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  return <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
    <h3 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('project.review.schedule')}</h3>
    <p className="mt-1 text-xs text-brand-mid-grey">{t('project.review.scheduledNote')}</p>
    <ol className="mt-5 divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {[...stages].sort((a, b) => a.stage_number - b.stage_number).map(stage => {
        const historical = stage.pre_existing === true;
        const complete = stage.status === 'complete';
        const current = stage.status === 'active' || stage.status === 'pending_review';
        const payment = !historical ? payments?.get(stage.id) : undefined;
        const confirmed = payment?.state === 'funded' || payment?.state === 'reconciled';
        const pending = payment?.state === 'receipt_submitted';
        const receipt = payment && (confirmed || pending) ? receiptPayoutSummary(project, [stage], [payment]) : null;
        const actual = confirmed ? receipt?.payouts : receipt?.pending;
        const unknown = confirmed ? receipt?.missingConfirmedCount : receipt?.missingPendingCount;
        const scheduled = stageScheduleUsd(stage, basis);
        const Icon = complete ? Check : current ? Clock : Lock;
        return <li key={stage.id} data-stage-status={stage.status} className="flex items-start gap-3 py-4">
          <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border ${complete ? 'border-brand-green bg-brand-green text-white' : current ? 'border-brand-near-black text-brand-near-black dark:border-white dark:text-white' : 'border-brand-border-grey text-brand-mid-grey'}`}><Icon className="size-3.5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-brand-near-black dark:text-white">{stageLabel(stage)}</p>
                <p className="mt-1 text-xs text-brand-mid-grey">{t(historical ? 'project.costing.completedBeforeTracking' : complete ? 'project.review.approved' : stage.status === 'pending_review' ? 'project.costing.awaitingApproval' : current ? 'project.costing.statusActive' : 'project.costing.statusLocked')}</p>
                {stage.completed_at && <p className="mt-1 font-mono text-[11px] text-brand-mid-grey">{new Date(stage.completed_at).toLocaleDateString()}</p>}
              </div>
              <div className="text-right">
                <MoneyValue usd={scheduled} amount={stage.milestone_amount} className="text-sm font-semibold text-brand-near-black dark:text-white" />
                <p className="mt-1 text-[11px] text-brand-mid-grey">{t('project.review.scheduledAmount')} · {formatShare(stage.budget_pct)}</p>
              </div>
            </div>
            {!historical && <div className="mt-3 text-xs text-brand-mid-grey">
              {confirmed || pending ? <>
                <p>{t(confirmed ? 'project.review.receiptConfirmed' : 'project.review.receiptSubmitted')}</p>
                {unknown || !actual ? <p>{t('project.costing.receiptAmountsMissing')}</p>
                  : <MoneyValue usd={actual.usd} amount={actual.amount} className="mt-1 text-sm" />}
              </> : t(scheduled === 0 ? 'project.review.freeStage' : 'project.review.receiptExpected')}
            </div>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
