import { useState } from 'react';
import { Calculator, Loader2, ArrowRight } from 'lucide-react';
import { previewReprice, applyReprice, RepriceUnavailable, type RepricePreview } from '@/lib/supabase/reprice';
import type { RepriceRow } from '@/lib/budget/reprice';
import { formatUSDFull } from '@/lib/budget';
import { useStageLabels } from '@/lib/stage-labels';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Re-cutting a live project's costing, with the figures shown first.
//
// 183 widened `budget_pct` and new projects get their own split; a project created
// before that keeps the national average for ever, because every writer of the schedule
// is a one-time creation step. Philip, 10 Nov 2026: "why is the costing still same
// thing".
//
// ── PREVIEW, THEN APPLY. NEVER ONE CLICK ──────────────────────────────────────────
// This changes what a client will be asked to pay on every remaining stage of a build
// already under way. The before and after of every line is on screen before anything is
// written, and what is written is the plan that was shown — not a second computation.
//
// ── WHAT IT WILL NOT TOUCH ────────────────────────────────────────────────────────
// Paid, completed and pre-existing stages keep their figure to the dollar, and the
// design fee keeps its absolute amount. Those rows are rendered too, greyed and labelled
// with why, because "this stage did not change" is the reassurance an administrator
// needs most before pressing the button. 184 re-checks every one of them anyway.
// =========================================================

const HELD_LABEL: Record<NonNullable<RepriceRow['heldReason']>, TKey> = {
  paid:         'admin.workspace.financials.reprice.heldPaid',
  complete:     'admin.workspace.financials.reprice.heldComplete',
  pre_existing: 'admin.workspace.financials.reprice.heldPre',
  fixed_fee:    'admin.workspace.financials.reprice.heldFixed',
};

const UNAVAILABLE: Record<RepriceUnavailable['reason'], TKey> = {
  no_takeoff:         'admin.workspace.financials.reprice.noTakeoff',
  no_budget:          'admin.workspace.financials.reprice.noBudget',
  nothing_to_change:  'admin.workspace.financials.reprice.noChange',
  does_not_balance:   'admin.workspace.financials.reprice.notBalanced',
};

export function RepriceCard({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const [preview, setPreview] = useState<RepricePreview | null>(null);
  const [busy,    setBusy]    = useState<'preview' | 'apply' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  async function onPreview() {
    setBusy('preview');
    setMessage(null);
    try {
      setPreview(await previewReprice(projectId));
    } catch (err) {
      setPreview(null);
      setMessage({
        kind: 'error',
        text: err instanceof RepriceUnavailable
          ? t(UNAVAILABLE[err.reason])
          : (err as Error).message,
      });
    } finally {
      setBusy(null);
    }
  }

  async function onApply() {
    if (!preview) return;
    setBusy('apply');
    setMessage(null);
    try {
      const { written } = await applyReprice(projectId, preview.plan);
      setPreview(null);
      setMessage({ kind: 'ok', text: t('admin.workspace.financials.reprice.done', { count: written }) });
      await onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-brand-near-black dark:text-white">
            <Calculator className="size-3.5 shrink-0" />
            {t('admin.workspace.financials.reprice.title')}
          </p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-brand-mid-grey">
            {t('admin.workspace.financials.reprice.sub')}
          </p>
        </div>
        {!preview && (
          <button
            type="button"
            onClick={onPreview}
            disabled={busy !== null}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-border-grey px-3 py-1.5 text-xs font-medium text-brand-near-black transition-colors hover:bg-brand-off-white disabled:opacity-50 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#282828]"
          >
            {busy === 'preview' && <Loader2 className="size-3 animate-spin" />}
            {t('admin.workspace.financials.reprice.action')}
          </button>
        )}
      </div>

      {message && (
        <p className={cn('mt-3 rounded-lg px-3 py-2 text-xs',
          message.kind === 'error'
            ? 'bg-state-held/10 text-state-held'
            : 'bg-state-complete/10 text-state-complete')}>
          {message.text}
        </p>
      )}

      {preview && (
        <div className="mt-4">
          {preview.plan.settledTotal > 0 && (
            <p className="mb-2 text-[11px] text-brand-mid-grey">
              {t('admin.workspace.financials.reprice.settledNote', {
                amount: formatUSDFull(preview.plan.settledTotal),
              })}
            </p>
          )}

          <ul className="divide-y divide-brand-border-grey rounded-xl border border-brand-border-grey dark:divide-[#2c2c2c] dark:border-[#2c2c2c]">
            {preview.plan.rows.map(r => (
              <li
                key={r.stageId}
                className={cn('flex items-center justify-between gap-3 px-3 py-2 text-xs',
                  r.settled && 'opacity-55')}
              >
                <span className="min-w-0 truncate text-brand-near-black dark:text-white">
                  <span className="tabular-nums text-brand-mid-grey">{r.stageNumber}. </span>
                  {stageLabel({ stage_key: r.stageKey, name: r.stageKey ?? '' })}
                  {r.heldReason && (
                    <span className="ml-1.5 text-[10px] text-brand-mid-grey">
                      · {t(HELD_LABEL[r.heldReason])}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                  <span className={cn(r.settled ? 'text-brand-mid-grey' : 'text-state-held line-through')}>
                    {formatUSDFull(r.wasAmount)}
                  </span>
                  {!r.settled && (
                    <>
                      <ArrowRight className="size-3 text-brand-mid-grey" />
                      <span className="font-semibold text-state-complete">{formatUSDFull(r.nowAmount)}</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onApply}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-near-black px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-brand-near-black"
            >
              {busy === 'apply' && <Loader2 className="size-3 animate-spin" />}
              {busy === 'apply'
                ? t('admin.workspace.financials.reprice.applying')
                : t('admin.workspace.financials.reprice.apply', { count: preview.plan.changes.length })}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setMessage(null); }}
              disabled={busy !== null}
              className="rounded-lg px-3 py-1.5 text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black disabled:opacity-50 dark:hover:text-white"
            >
              {t('admin.workspace.financials.reprice.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
