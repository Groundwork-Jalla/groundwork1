import { useEffect, useRef, useState } from 'react';
import { useLanguage, useT } from '@/lib/i18n';
import { closeProject, closeoutNotInstalled, fetchProjectCloseout, type ProjectCloseout } from '@/lib/supabase/project-closeout';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

// =========================================================
// Close-out: the last step of a project.
//
// Shown once every stage is complete and the project is still open. It says what is
// still owed and on which stage, and it is the only place the project is closed from
// when money was ever outstanding. The button is refused by the database as well; this
// component only explains why, in the words of whoever is reading.
//
// A project that was fully paid when its last stage was approved completes by itself, as
// it always did, and never shows this.
// =========================================================

interface Props {
  projectId: string;
  /** Anything that changes when payments or stages change, so the figures are re-read. */
  refreshKey: unknown;
  /** Open the stage that still owes money. */
  onViewStage?: (stageId: string) => void;
  onClosed?: () => void | Promise<void>;
  stageName?: (stageId: string, stageNumber: number) => string;
}

export function ProjectCloseoutPanel({ projectId, refreshKey, onViewStage, onClosed, stageName }: Props) {
  const t = useT(); const { lang } = useLanguage();
  const current = useRef(projectId); current.current = projectId;
  const [read, setRead] = useState<{ project: string; data: ProjectCloseout | null }>({ project: projectId, data: null });
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProjectCloseout(projectId)
      .then(data => { if (alive) setRead({ project: projectId, data }); })
      // Not installed, or not a member: no panel. A close-out that cannot be read is
      // never shown as "nothing owed".
      .catch(failure => { if (alive && !closeoutNotInstalled(failure)) setRead({ project: projectId, data: null }); });
    return () => { alive = false; };
  }, [projectId, refreshKey]);

  const data = read.project === projectId ? read.data : null;
  if (!data || data.closed || !data.all_stages_complete || data.status !== 'active') return null;

  const money = (value: string) => `${Number(value).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })} ${data.currency ?? ''}`.trim();
  const owed = Number(data.outstanding) > 0;
  const waiting = data.pending_receipts > 0;

  async function commit() {
    if (working || !data?.can_close) return;
    setWorking(true); setError(null);
    try {
      const next = await closeProject(projectId);
      if (current.current !== projectId) return;
      setRead({ project: projectId, data: next }); setConfirming(false);
      await onClosed?.();
    } catch (failure) {
      if (current.current !== projectId) return;
      const reason = (failure as Error)?.message ?? '';
      setConfirming(false);
      setError(t(/closeout_balance_outstanding/.test(reason) ? 'project.closeout.errBalance'
        : /closeout_receipt_pending/.test(reason) ? 'project.closeout.errPending'
        : /not_authorized/.test(reason) ? 'project.closeout.errRole' : 'project.closeout.errGeneric'));
      // The figures that refused it are the figures to show.
      fetchProjectCloseout(projectId).then(fresh => { if (current.current === projectId) setRead({ project: projectId, data: fresh }); }).catch(() => {});
    } finally { if (current.current === projectId) setWorking(false); }
  }

  return (
    <section aria-labelledby="closeout-title" data-closeout={owed ? 'owed' : waiting ? 'waiting' : 'ready'}
      className="space-y-3 rounded-2xl border border-brand-border-grey bg-white p-5 text-sm dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 id="closeout-title" className="text-base font-bold text-brand-near-black">{t('project.closeout.title')}</h3>
      <p className="text-brand-mid-grey">{t(owed ? 'project.closeout.owedIntro' : waiting ? 'project.closeout.waitingIntro' : 'project.closeout.readyIntro')}</p>

      {owed && (
        <>
          <p role="status" className="font-semibold text-brand-near-black">{t('project.closeout.outstanding', { amount: money(data.outstanding) })}</p>
          <ul className="divide-y divide-brand-border-grey rounded-xl border border-brand-border-grey">
            {data.stages.map(stage => (
              <li key={stage.stage_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span>{stageName?.(stage.stage_id, stage.stage_number) ?? t('project.closeout.stage', { n: stage.stage_number })}</span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{money(stage.remaining)}</span>
                  {onViewStage && <button type="button" onClick={() => onViewStage(stage.stage_id)} className="min-h-9 rounded-lg border border-brand-green px-3 py-1.5 text-xs font-semibold text-brand-green">{t('project.closeout.viewStage')}</button>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {waiting && <p role="status">{t('project.closeout.pending', { count: data.pending_receipts })}</p>}

      {data.can_close
        ? <button type="button" disabled={working} onClick={() => { setError(null); setConfirming(true); }}
            className="min-h-11 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover disabled:opacity-50">{t('project.closeout.close')}</button>
        : !owed && !waiting && <p className="text-brand-mid-grey">{t('project.closeout.notYourCall')}</p>}
      {error && <p role="alert" className="text-state-alert">{error}</p>}

      <ConfirmModal open={confirming} title={t('project.closeout.confirmTitle')} description={t('project.closeout.confirmBody')}
        confirmLabel={t('project.closeout.close')} cancelLabel={t('common.cancel')} loading={working}
        onConfirm={() => void commit()} onCancel={() => { if (!working) setConfirming(false); }} />
    </section>
  );
}
