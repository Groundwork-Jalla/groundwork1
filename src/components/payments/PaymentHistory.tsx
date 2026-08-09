import { Download } from 'lucide-react';
import { useFormat, useT, useLanguage } from '@/lib/i18n';
import { projectBudget } from '@/lib/budget';
import { MoneyBadge } from '@/components/ui/StatusBadge';
import { cn } from '@/lib/utils';
import type { ProjectRow, ProjectStageRow, ProjectTier, ConstructionRate } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';

export default function PaymentHistory({
  project, stages, tier, rate, onViewPayout,
}: {
  project: ProjectRow;
  stages: ProjectStageRow[];
  tier: ProjectTier;
  rate: ConstructionRate | null;
  onViewPayout: (stage: ProjectStageRow) => void;
}) {
  const t         = useT();
  const { tPlural } = useLanguage();
  const { stageLabel } = useStageLabels();
  const f         = useFormat();
  // Falls back to the engine estimate when no budget is confirmed, so "remaining"
  // is never the whole total just because budget_usd is still null.
  const total     = projectBudget(project).total;
  const paid      = stages.filter(s => s.payment_status === 'paid' || s.payment_status === 'partial');
  const totalPaid = paid.reduce((s, st) => s + (st.payment_milestone_usd ?? 0), 0);
  const remaining = Math.max(0, total - totalPaid);
  const lockedCount = stages.filter(s => s.payment_status === 'unpaid').length;

  const ordered = [...paid].sort((a, b) => {
    const ta = a.completed_at ? +new Date(a.completed_at) : 0;
    const tb = b.completed_at ? +new Date(b.completed_at) : 0;
    return tb - ta || b.stage_number - a.stage_number;
  });

  /**
   * CSV of the payments shown, for the owner's own records and their accountant.
   *
   * Built here rather than server-side: this is the same data already on screen, so
   * a round trip would add a failure mode without adding a column. Fields are quoted
   * and internal quotes doubled — project and stage names are free text and a comma
   * in one would otherwise shift every following column.
   */
  function handleExportCSV() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const header = [
      t('project.payments.csvStage'), t('project.payments.csvName'),
      t('project.payments.csvDate'),  t('project.payments.csvAmount'),
      t('project.payments.csvMethod'), t('project.payments.csvStatus'),
    ];
    const rows = ordered.map(p => [
      p.stage_number,
      stageLabel(p),
      p.completed_at ? f.date(p.completed_at) : '',
      (p.payment_milestone_usd ?? 0).toFixed(2),
      t('project.payments.momo'),
      p.payment_status === 'paid'
        ? t('project.payments.statusReleased')
        : t('project.payments.statusInTransit'),
    ]);

    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    // BOM so Excel opens UTF-8 correctly — stage names carry accents in French.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9-_]+/g, '-')}-payments.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-brand-near-black dark:text-white">
          {t('project.payments.historyTitle')}
        </p>
        <button
          type="button"
          onClick={handleExportCSV}
          disabled={ordered.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]"
        >
          <Download className="size-3" />
          {t('project.payments.exportCsv')}
        </button>
      </div>

      {/* Dark summary header */}
      <div className="rounded-2xl bg-brand-near-black text-white flex px-6 py-5 mb-6">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">{t('project.payments.totalPaid')}</p>
          <p className="text-2xl font-extrabold mt-1 figure">{f.money(totalPaid)}</p>
          <p className="text-[11px] text-white/35 mt-0.5">{t('project.payments.ofStages', { done: paid.length, total: stages.length || 10 })}</p>
        </div>
        <div className="w-px bg-white/10 mx-5" />
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">{t('project.payments.remainingLabel')}</p>
          <p className="text-2xl font-extrabold mt-1 figure">{f.money(remaining)}</p>
          <p className="text-[11px] text-white/35 mt-0.5">{tPlural('project.payments.stagesUnpaid', lockedCount)}</p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey dark:border-[#2c2c2c] px-6 py-12 text-center">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('project.payments.noPaymentsTitle')}</p>
          <p className="text-xs text-brand-mid-grey mt-1">{t('project.payments.noPaymentsBody')}</p>
        </div>
      ) : (
        <div className="relative pl-6">
          {/* timeline spine */}
          <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-brand-border-grey dark:bg-[#2c2c2c]" />
          {ordered.map(p => {
            const isPaid = p.payment_status === 'paid';
            const amount = p.payment_milestone_usd ?? 0;
            return (
              <div key={p.id} className="relative mb-4">
                <span className={cn(
                  'absolute -left-[20px] top-3.5 size-4 rounded-full border-[3px] border-white dark:border-[#141414]',
                  isPaid ? 'bg-state-complete' : 'bg-state-active',
                )} style={{ boxShadow: '0 0 0 1px var(--color-rule)' }} />
                <button
                  type="button"
                  onClick={() => onViewPayout(p)}
                  className="w-full text-left rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] shadow-[0_4px_16px_rgba(0,0,0,0.04)] p-4 hover:border-brand-near-black dark:hover:border-white transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="min-w-0">
                      <MoneyBadge bucket={isPaid ? 'released' : 'in_transit'} size="small" />
                      <p className="text-sm font-bold text-brand-near-black dark:text-white mt-2 leading-snug">
                        {t('project.stages.stageN', { n: p.stage_number })}: {stageLabel(p)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-extrabold text-brand-near-black dark:text-white figure">{f.money(amount)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-brand-mid-grey flex-wrap">
                    <span>{f.date(p.completed_at)}</span>
                    <span className="text-ink-35">·</span>
                    <span>{t('project.payments.momo')}</span>
                    <span className="text-ink-35">·</span>
                    <span className="text-brand-near-black dark:text-white font-medium">{t('project.payments.viewPayout')}</span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
